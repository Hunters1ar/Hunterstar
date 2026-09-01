$ErrorActionPreference = 'Stop'

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command,

        [Parameter(Mandatory = $true)]
        [string]$ErrorMessage
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw $ErrorMessage
    }
}

$projectRoot = $env:PROJECT_ROOT
if ([string]::IsNullOrWhiteSpace($projectRoot)) {
    $projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

$vpsHost = $env:VPS_HOST
if ([string]::IsNullOrWhiteSpace($vpsHost)) {
    $vpsHost = 'root@api.hunterstar.uz'
}

$vpsApiUrl = $env:VPS_API_URL
if ([string]::IsNullOrWhiteSpace($vpsApiUrl)) {
    $vpsApiUrl = 'https://api.hunterstar.uz'
}

$commitMessage = $env:COMMIT_MSG
if ([string]::IsNullOrWhiteSpace($commitMessage)) {
    $commitMessage = 'fixed'
}

$sshOptions = @(
    '-o', 'ConnectTimeout=20',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=2'
)

Set-Location -LiteralPath $projectRoot

Invoke-Step {
    $items = @('.firebaserc', '.gitignore', '.vercelignore', 'vercel.json', 'firebase.json', 'firestore.rules', 'storage.rules', 'package.json', 'cspell.json', 'README.md', 'robots.txt', 'sitemap.xml', 'deploy.bat', '*.html', 'css', 'js', 'assets', 'private', 'functions', 'api')
    $existingItems = $items | Where-Object { $_ -eq '*.html' -or (Test-Path -Path $_) }
    & git add -A -- $existingItems
} 'git add failed'

& git diff --cached --quiet
$diffExit = $LASTEXITCODE

if ($diffExit -eq 1) {
    Invoke-Step { & git commit -m $commitMessage } 'git commit failed'
} elseif ($diffExit -gt 1) {
    throw 'git diff failed'
} else {
    Write-Host 'No staged source changes to commit.'
}

Invoke-Step { & git push } 'git push failed. VPS deploy skipped.'

Write-Host ''
Write-Host 'Checking VPS SSH key...' -ForegroundColor Cyan
Invoke-Step { & ssh @sshOptions $vpsHost 'true' } 'SSH key auth failed. Add your SSH key to the VPS root account, then rerun deploy.bat.'

Write-Host 'Uploading VPS API, admin, and private files...' -ForegroundColor Cyan
$remoteDir = '/tmp/portfolio-api-deploy-' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$setupCmd = "rm -rf '$remoteDir' && mkdir -p '$remoteDir/api' '$remoteDir/site/css' '$remoteDir/site/js' '$remoteDir/site/assets' '$remoteDir/site/private'"
Invoke-Step { & ssh @sshOptions $vpsHost $setupCmd } 'SSH setup failed'

$apiFiles = @(
    'api/server.js',
    'api/package.json',
    'api/ecosystem.config.js',
    'api/.env.example',
    'api/deploy.sh'
)

if (Test-Path -LiteralPath 'api/package-lock.json') {
    $apiFiles += 'api/package-lock.json'
}

if (Test-Path -LiteralPath 'api/service-account.json') {
    $apiFiles += 'api/service-account.json'
}

$apiDest = $vpsHost + ':' + $remoteDir + '/api/'
Invoke-Step { & scp @sshOptions @apiFiles $apiDest } 'SCP API upload failed'

Invoke-Step { & scp @sshOptions admin.html ($vpsHost + ':' + $remoteDir + '/site/') } 'SCP admin HTML upload failed'
if (Test-Path -LiteralPath 'private') {
    Invoke-Step { & scp @sshOptions private/index.html private/book.html ($vpsHost + ':' + $remoteDir + '/site/private/') } 'SCP private HTML upload failed'
}
Invoke-Step { & scp @sshOptions css/styles.css ($vpsHost + ':' + $remoteDir + '/site/css/') } 'SCP admin CSS upload failed'
Invoke-Step { & scp @sshOptions js/admin.js js/firebase-config.js ($vpsHost + ':' + $remoteDir + '/site/js/') } 'SCP admin JS upload failed'

$privateStaticFiles = @(
    'favicon-96x96.png',
    'favicon.svg',
    'favicon.ico',
    'apple-touch-icon.png',
    'site.webmanifest'
) | Where-Object { Test-Path -LiteralPath $_ }

if ($privateStaticFiles.Count -gt 0) {
    Invoke-Step { & scp @sshOptions @privateStaticFiles ($vpsHost + ':' + $remoteDir + '/site/') } 'SCP private static assets upload failed'
}

if (Test-Path -LiteralPath 'assets/logo.png') {
    Invoke-Step { & scp @sshOptions assets/logo.png ($vpsHost + ':' + $remoteDir + '/site/assets/') } 'SCP admin assets upload failed'
}

$idCommand = '$(id -u)'
$runCmd = "set -e; cd '$remoteDir/api'; if [ $idCommand -eq 0 ]; then bash deploy.sh; else sudo bash deploy.sh; fi; rm -rf '$remoteDir'"
Invoke-Step { & ssh @sshOptions $vpsHost $runCmd } 'VPS API deployment failed'

Write-Host ''
Write-Host "VPS API deployed: $vpsApiUrl" -ForegroundColor Green
Write-Host "Health check: $vpsApiUrl/api/health"
Write-Host 'Admin console: https://admin.hunterstar.uz'
