$ErrorActionPreference = 'Stop'
$operations = Split-Path -Parent $PSScriptRoot
$project = Split-Path -Parent $operations
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (!(Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework C# compiler is required to rebuild.' }

Push-Location $PSScriptRoot
try {
    foreach ($mode in @('start', 'stop')) {
        $name = if ($mode -eq 'start') { '전시 시작.exe' } else { '전시 종료.exe' }
        $response = Join-Path $PSScriptRoot ('build-' + $mode + '.rsp')
        $options = @('/nologo', '/target:winexe', '/optimize+', '/platform:anycpu', '/r:System.Windows.Forms.dll', ('/out:"..\' + $name + '"'), 'ExhibitionLauncher.cs')
        if ($mode -eq 'stop') { $options += '/define:STOP' }
        [IO.File]::WriteAllLines($response, $options, (New-Object Text.UTF8Encoding($true)))
        & $compiler ('@build-' + $mode + '.rsp')
        if ($LASTEXITCODE -ne 0) { throw "Build failed: $name" }
        Remove-Item -LiteralPath $response
    }
} finally { Pop-Location }

$package = Join-Path $operations '전시 실행 패키지'
New-Item -ItemType Directory -Path $package -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $operations '전시 시작.exe'), (Join-Path $operations '전시 종료.exe') -Destination $package -Force

# Only app files are included. Git history and private runtime profiles stay out.
function Copy-Content([string]$source, [string]$destination) {
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    foreach ($item in Get-ChildItem -LiteralPath $source -Force) {
        if ($item.Name -eq '.git' -or $item.Name -like '.runtime*') { continue }
        $target = Join-Path $destination $item.Name
        if ($item.PSIsContainer) { Copy-Content $item.FullName $target }
        else { Copy-Item -LiteralPath $item.FullName -Destination $target -Force }
    }
}
Copy-Content (Join-Path $project 'skateboardword') (Join-Path $package '콘텐츠')
Copy-Item -LiteralPath (Join-Path $operations '다른 PC에서 실행.txt') -Destination (Join-Path $package '사용법.txt') -Force

$archive = Join-Path $operations '전시 실행 패키지.zip'
$items = @('전시 시작.exe', '전시 종료.exe', '콘텐츠', '사용법.txt') | ForEach-Object { Join-Path $package $_ }
Compress-Archive -LiteralPath $items -DestinationPath $archive -Force
Write-Output ('Ready: ' + $archive)
