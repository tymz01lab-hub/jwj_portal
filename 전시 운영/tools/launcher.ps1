param([ValidateSet('Start', 'Stop')][string]$Action)
$ErrorActionPreference = 'Stop'
$runtime = Join-Path (Split-Path $PSScriptRoot -Parent) '.runtime'
$stateFile = Join-Path $runtime 'session.json'
$serverFile = Join-Path $PSScriptRoot 'server.cjs'
$url = 'http://127.0.0.1:8199'
$state = $null

function Save-State {
    $state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
}

function Get-OwnedProcess($IdValue, $StartedValue) {
    if (-not $IdValue -or -not $StartedValue) { return $null }
    $process = Get-Process -Id $IdValue -ErrorAction SilentlyContinue
    if ($process -and $process.StartTime.ToUniversalTime().Ticks.ToString() -eq $StartedValue) {
        return $process
    }
    return $null
}

function Stop-Session {
    if (-not $state) { return }
    $browser = Get-OwnedProcess $state.browserId $state.browserStarted
    if ($browser) {
        # Chrome subprocesses can exit during taskkill. Check the browser itself
        # after shutdown instead of treating every taskkill warning as a failure.
        $previousPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & "$env:SystemRoot\System32\taskkill.exe" /PID $browser.Id /T /F 2>&1 | Out-Null
        } finally { $ErrorActionPreference = $previousPreference }
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            if (-not (Get-OwnedProcess $state.browserId $state.browserStarted)) { break }
            Start-Sleep -Milliseconds 100
        }
        if (Get-OwnedProcess $state.browserId $state.browserStarted) {
            throw 'Could not close exhibition Chrome. Please try Stop again.'
        }
    }
    $server = Get-OwnedProcess $state.serverId $state.serverStarted
    if ($server) { Stop-Process -Id $server.Id -Force }
    if (Test-Path -LiteralPath $stateFile) { Remove-Item -LiteralPath $stateFile }
}

function Test-Server {
    if (-not (Get-OwnedProcess $state.serverId $state.serverStarted)) { return $false }
    try {
        $reply = Invoke-WebRequest -UseBasicParsing -Uri "$url/__exhibition/status" -TimeoutSec 1 -Headers @{ 'X-Exhibition-Token' = $state.token }
        return $reply.Content -eq 'jamo-exhibition'
    } catch { return $false }
}

# Serialize Start/Stop clicks for this project folder.
$hash = [System.Security.Cryptography.SHA256]::Create()
$key = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($PSScriptRoot.ToLowerInvariant()))).Replace('-', '')
$hash.Dispose()
$mutex = New-Object System.Threading.Mutex($false, "Local\JamoExhibition-$key")
$locked = $false
$launching = $false
try {
    try { $locked = $mutex.WaitOne(15000) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'Another exhibition command is running. Please try again shortly.' }
    if (Test-Path -LiteralPath $stateFile) {
        $state = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    if ($Action -eq 'Stop') { Stop-Session; exit 0 }
    if ($state -and (Test-Server) -and (Get-OwnedProcess $state.browserId $state.browserStarted)) { exit 0 }
    Stop-Session

    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $chrome = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA) |
        Where-Object { $_ } |
        ForEach-Object { Join-Path $_ 'Google\Chrome\Application\chrome.exe' } |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $chrome) { throw 'Google Chrome is not installed.' }
    $content = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'skateboardword\index.html'
    if (-not (Test-Path -LiteralPath $content)) { throw 'skateboardword/index.html was not found. Keep this folder inside the project.' }
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $state = [pscustomobject]@{
        serverId = 0; serverStarted = ''; browserId = 0; browserStarted = '';
        token = [Guid]::NewGuid().ToString('N')
    }
    $launching = $true
    $server = Start-Process -FilePath $node -ArgumentList @(('"{0}"' -f $serverFile), '8199', $state.token) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'server.log') -RedirectStandardError (Join-Path $runtime 'server-error.log')
    $state.serverId = $server.Id
    $state.serverStarted = $server.StartTime.ToUniversalTime().Ticks.ToString()
    Save-State
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (Test-Server) { $ready = $true; break }
        if (-not (Get-OwnedProcess $state.serverId $state.serverStarted)) { break }
        Start-Sleep -Milliseconds 150
    }
    if (-not $ready) { throw 'The exhibition server could not start. Port 8199 may be in use. See .runtime/server-error.log.' }
    $chromeProfile = Join-Path $runtime 'chrome-profile'
    $browser = Start-Process -FilePath $chrome -ArgumentList @(
        ('"--user-data-dir={0}"' -f $chromeProfile), '--no-first-run', '--no-default-browser-check',
        '--disable-session-crashed-bubble', '--kiosk', $url
    ) -PassThru
    $state.browserId = $browser.Id
    $state.browserStarted = $browser.StartTime.ToUniversalTime().Ticks.ToString()
    Save-State
    Start-Sleep -Milliseconds 800
    if (-not (Get-OwnedProcess $state.browserId $state.browserStarted)) { throw 'Exhibition Chrome did not stay open. Check for an older exhibition window.' }
    $launching = $false
} catch {
    $detail = $_.Exception.Message
    if ($launching) { try { Stop-Session } catch { $detail += "`n" + $_.Exception.Message } }
    if (Test-Path -LiteralPath $runtime) { $detail | Set-Content -LiteralPath (Join-Path $runtime 'launcher-error.log') -Encoding UTF8 }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($detail, 'Exhibition / 전시 운영', 'OK', 'Error') | Out-Null
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
