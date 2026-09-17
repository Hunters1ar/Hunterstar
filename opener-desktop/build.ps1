$ErrorActionPreference = 'Stop'
$projectFile = Join-Path $PSScriptRoot 'Hunterstar.Opener.csproj'
$outputDirectory = Join-Path $PSScriptRoot 'app'
& dotnet publish $projectFile -c Release -o $outputDirectory --self-contained true -p:CreateRootLauncher=true
if ($LASTEXITCODE -ne 0) { throw 'Account Center build failed. Close the app if it is running, then retry.' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $outputDirectory 'README.md')

$credsSources = @(
    (Join-Path $PSScriptRoot 'service-account.json'),
    (Join-Path $PSScriptRoot '..\api\service-account.json')
)
foreach ($source in $credsSources) {
    if (Test-Path $source) {
        $appCreds = Join-Path $outputDirectory 'service-account.json'
        if (-not (Test-Path $appCreds)) { Copy-Item -LiteralPath $source -Destination $appCreds -Force }
        $localCredsDir = Join-Path $env:LOCALAPPDATA 'Hunterstar\Opener'
        if (-not (Test-Path $localCredsDir)) { New-Item -ItemType Directory -Path $localCredsDir -Force | Out-Null }
        $localCreds = Join-Path $localCredsDir 'service-account.json'
        if (-not (Test-Path $localCreds)) { Copy-Item -LiteralPath $source -Destination $localCreds -Force }
        break
    }
}

Write-Host "Ready root launcher: $PSScriptRoot\AccountCenter.exe"
Write-Host "Ready app standalone: $outputDirectory\AccountCenter.exe"

