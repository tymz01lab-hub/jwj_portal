$ErrorActionPreference='Stop'
$operations=Split-Path -Parent $PSScriptRoot
$standalone=Join-Path $operations '.runtime/standalone-web-rebuilt'
New-Item -ItemType Directory -Path $standalone -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $operations '웹 실행/스케이트보드 전시 시작.exe') -Destination $standalone -Force
$startPath=Join-Path $standalone '스케이트보드 전시 시작.exe'
$stopPath=Join-Path $operations '웹 실행/스케이트보드 전시 종료.exe'
$statePath=Join-Path ([IO.Path]::GetTempPath()) 'JamoSkateExhibition-Web-QA/browser.txt'
$previous=@(Get-Process -Name chrome -ErrorAction SilentlyContinue | ForEach-Object { @{Id=$_.Id;Started=$_.StartTime.Ticks} })
function Check($ok,$message) { if (!$ok) { throw $message }; Write-Output ('PASS: '+$message) }
try {
    Check (@(Get-ChildItem -LiteralPath $standalone -Force).Count -eq 1) 'Only the start EXE is copied; no content or server files'
    $start=Start-Process -FilePath $startPath -ArgumentList '--test-browser' -WindowStyle Hidden -PassThru
    Check ($start.WaitForExit(10000) -and $start.ExitCode -eq 0) 'Standalone EXE starts Chrome and exits'
    $state=Get-Content -LiteralPath $statePath
    Check (!!(Get-Process -Id ([int]$state[0]) -ErrorAction SilentlyContinue)) 'Dedicated Chrome stays running'
    $duplicate=Start-Process -FilePath $startPath -ArgumentList '--test-browser' -WindowStyle Hidden -PassThru
    Check ($duplicate.WaitForExit(5000) -and $duplicate.ExitCode -eq 0) 'Repeated start is harmless'
    $nextState=Get-Content -LiteralPath $statePath
    Check ($nextState[0] -ne $state[0]) 'Start recovers when an old Chrome process has no visible window'
    Check (!(Get-Process -Id ([int]$state[0]) -ErrorAction SilentlyContinue)) 'Windowless old Chrome session is removed'
    $state=$nextState
    $stop=Start-Process -FilePath $stopPath -ArgumentList '--test-browser' -WindowStyle Hidden -PassThru
    Check ($stop.WaitForExit(10000) -and $stop.ExitCode -eq 0) 'Optional stop EXE works independently'
    Check (!(Get-Process -Id ([int]$state[0]) -ErrorAction SilentlyContinue)) 'Only dedicated Chrome closes'
    Check (!(Test-Path -LiteralPath $statePath)) 'Browser session state is removed'
    $stopAgain=Start-Process -FilePath $stopPath -ArgumentList '--test-browser' -WindowStyle Hidden -PassThru
    Check ($stopAgain.WaitForExit(10000) -and $stopAgain.ExitCode -eq 0) 'Repeated stop exits normally'
    $missing=@($previous | Where-Object { $p=Get-Process -Id $_.Id -ErrorAction SilentlyContinue; !$p -or $p.StartTime.Ticks -ne $_.Started })
    Check ($missing.Count -eq 0) 'Other Chrome processes remain open'
} finally {
    $cleanup=Start-Process -FilePath $stopPath -ArgumentList '--test-browser' -WindowStyle Hidden -PassThru
    $cleanup.WaitForExit(10000) | Out-Null
}
