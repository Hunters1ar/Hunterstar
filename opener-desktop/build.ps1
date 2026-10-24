$ErrorActionPreference = 'Stop'
$projectFile = Join-Path $PSScriptRoot 'Hunterstar.Opener.csproj'
$outputDirectory = Join-Path $PSScriptRoot 'app'
& dotnet publish $projectFile -c Release -o $outputDirectory --self-contained true -p:CreateRootLauncher=true
if ($LASTEXITCODE -ne 0) { throw 'Account Center build failed. Close the app if it is running, then retry.' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $outputDirectory 'README.md')

Write-Host "Ready root launcher: $PSScriptRoot\AccountCenter.exe"
Write-Host "Ready app standalone: $outputDirectory\AccountCenter.exe"
