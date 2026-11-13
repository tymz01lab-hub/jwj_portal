$ErrorActionPreference = 'Stop'
$outputFolder = Join-Path (Split-Path -Parent $PSScriptRoot) '웹 실행'
New-Item -ItemType Directory -Path $outputFolder -Force | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
Push-Location $PSScriptRoot
try {
    foreach ($mode in @('start', 'stop')) {
        $name = if ($mode -eq 'start') { '스케이트보드 전시 시작.exe' } else { '스케이트보드 전시 종료.exe' }
        $response = Join-Path $PSScriptRoot ('build-web-' + $mode + '.rsp')
        $options = @('/nologo', '/target:winexe', '/optimize+', '/platform:anycpu', '/r:System.Windows.Forms.dll', ('/out:"..\웹 실행\' + $name + '"'), 'WebLauncher.cs')
        if ($mode -eq 'stop') { $options += '/define:STOP' }
        [IO.File]::WriteAllLines($response, $options, (New-Object Text.UTF8Encoding($true)))
        & $compiler ('@build-web-' + $mode + '.rsp')
        if ($LASTEXITCODE -ne 0) { throw "Build failed: $name" }
        Remove-Item -LiteralPath $response
    }
} finally { Pop-Location }
Get-ChildItem -LiteralPath $outputFolder -Filter '*.exe' | Select-Object Name,Length
