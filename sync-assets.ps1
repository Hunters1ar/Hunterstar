<#
.SYNOPSIS
    Syncs the Hunterstar portfolio web files into the Android app's assets directory.

.DESCRIPTION
    Copies HTML/CSS/JS/3D model files from the portfolio web root into
    android/app/src/main/assets/ for offline WebView loading via WebViewAssetLoader.
    
    Excludes heavy dev artifacts (.git, node_modules, android/, functions/),
    and the large GLB file to keep the APK size manageable.

.PARAMETER WebRoot
    Path to the portfolio web root. Defaults to the script's parent directory.

.PARAMETER AssetsDir
    Target assets directory. Defaults to android/app/src/main/assets/ relative to WebRoot.

.EXAMPLE
    .\sync-assets.ps1
    .\sync-assets.ps1 -WebRoot "E:\move\portfolio" -AssetsDir "E:\move\portfolio\android\app\src\main\assets"
#>

[CmdletBinding()]
param(
    [string]$WebRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path),
    [string]$AssetsDir = ""
)

# ── Configuration ─────────────────────────────────────────────────────

if (-not $AssetsDir) {
    $AssetsDir = Join-Path $WebRoot "android\app\src\main\assets"
}

# Directories to exclude from copy
$ExcludeDirs = @(
    '.git',
    '.idea',
    '.vercel',
    'node_modules',
    'android',
    'functions',
    'projects',
    '.firebase',
    '.github'
)

# File patterns to exclude
$ExcludeFiles = @(
    '*.map',           # Source maps
    '*.md',            # Documentation
    '*.bat',           # Build scripts
    '*.ps1',           # PowerShell scripts
    '*.log',           # Logs
    '.env*',           # Environment secrets
    '.git*',           # Git files
    'firebase.json',   # Firebase config
    'firestore.rules',
    'storage.rules',
    '.firebaserc',
    'package*.json',   # NPM files
    'cspell.json',
    'vercel.json',
    '.vercelignore',
    'deploy.bat'
)

# File extensions to include (whitelist approach for assets)
$IncludeExtensions = @(
    '.html',
    '.css',
    '.js',
    '.json',
    '.svg',
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.ico',
    '.woff',
    '.woff2',
    '.ttf',
    '.otf',
    '.txt',
    '.xml',
    '.webmanifest',
    '.glb',
    '.gltf'
)

# ── Functions ─────────────────────────────────────────────────────────

function Write-Step {
    param([string]$Message, [string]$Color = "Cyan")
    Write-Host "  ⚡ " -NoNewline -ForegroundColor DarkRed
    Write-Host $Message -ForegroundColor $Color
}

function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkRed
    Write-Host "  $Message" -ForegroundColor White
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkRed
}

# ── Main ──────────────────────────────────────────────────────────────

Write-Header "Hunterstar Asset Sync"
Write-Step "Web Root:   $WebRoot"
Write-Step "Assets Dir: $AssetsDir"
Write-Host ""

# Validate web root
if (-not (Test-Path (Join-Path $WebRoot "index.html"))) {
    Write-Host "  ✗ ERROR: index.html not found in $WebRoot" -ForegroundColor Red
    Write-Host "    Make sure you run this from the portfolio root." -ForegroundColor Yellow
    exit 1
}

# Clean existing assets (fresh sync)
if (Test-Path $AssetsDir) {
    Write-Step "Cleaning existing assets directory..." "Yellow"
    Remove-Item -Path $AssetsDir -Recurse -Force
}

# Create assets directory
New-Item -Path $AssetsDir -ItemType Directory -Force | Out-Null
Write-Step "Created assets directory" "Green"

# Gather all files from web root
$allFiles = Get-ChildItem -Path $WebRoot -Recurse -File -ErrorAction SilentlyContinue

$copiedCount = 0
$skippedCount = 0
$totalBytes = 0

foreach ($file in $allFiles) {
    $relativePath = $file.FullName.Substring($WebRoot.Length).TrimStart('\', '/')
    $relativeDir = Split-Path $relativePath -Parent

    # Check if file is inside an excluded directory
    $skip = $false
    foreach ($excludeDir in $ExcludeDirs) {
        if ($relativePath -like "$excludeDir\*" -or $relativePath -like "$excludeDir/*") {
            $skip = $true
            break
        }
    }
    if ($skip) {
        $skippedCount++
        continue
    }

    # Check if file matches an exclude pattern
    foreach ($pattern in $ExcludeFiles) {
        if ($file.Name -like $pattern) {
            $skip = $true
            break
        }
    }
    if ($skip) {
        $skippedCount++
        continue
    }

    # Check file extension whitelist
    $ext = $file.Extension.ToLower()
    if ($ext -and $IncludeExtensions -notcontains $ext) {
        $skippedCount++
        continue
    }

    # Skip very large files (>25MB) to keep APK lean
    if ($file.Length -gt 25MB) {
        Write-Step "Skipping large file ($([math]::Round($file.Length / 1MB, 1))MB): $relativePath" "Yellow"
        $skippedCount++
        continue
    }

    # Copy the file
    $destPath = Join-Path $AssetsDir $relativePath
    $destDir = Split-Path $destPath -Parent
    if (-not (Test-Path $destDir)) {
        New-Item -Path $destDir -ItemType Directory -Force | Out-Null
    }

    Copy-Item -Path $file.FullName -Destination $destPath -Force
    $copiedCount++
    $totalBytes += $file.Length
}

# Also copy the hunterstar-bridge.js into assets if it exists at root
$bridgeSrc = Join-Path $WebRoot "hunterstar-bridge.js"
if (Test-Path $bridgeSrc) {
    Copy-Item -Path $bridgeSrc -Destination (Join-Path $AssetsDir "hunterstar-bridge.js") -Force
    Write-Step "Included hunterstar-bridge.js in assets" "Green"
}

# ── Summary ───────────────────────────────────────────────────────────
Write-Host ""
Write-Header "Sync Complete"
$sizeMB = [math]::Round($totalBytes / 1MB, 2)
Write-Step "Files copied:  $copiedCount" "Green"
Write-Step "Files skipped: $skippedCount" "DarkGray"
Write-Step "Total size:    ${sizeMB}MB" "Green"
Write-Host ""

# Show directory tree summary
Write-Step "Asset directory structure:" "White"
$assetDirs = Get-ChildItem -Path $AssetsDir -Directory -Recurse | 
    ForEach-Object { $_.FullName.Substring($AssetsDir.Length).TrimStart('\', '/') } |
    Sort-Object
foreach ($dir in $assetDirs) {
    $fileCount = (Get-ChildItem -Path (Join-Path $AssetsDir $dir) -File).Count
    Write-Host "    > $dir/ ($fileCount files)" -ForegroundColor DarkGray
}
$rootFileCount = (Get-ChildItem -Path $AssetsDir -File).Count
Write-Host "    - ./ ($rootFileCount root files)" -ForegroundColor DarkGray
Write-Host ""
