@echo off
setlocal EnableExtensions EnableDelayedExpansion

:: ============================================================
:: Hunterstar - Fast Deploy
:: - Git commit + push (all tracked files)
:: - SCP api/server.js to VPS  (direct IP, proven to work)
:: - PM2 restart portfolio-api
:: - Health check
::
:: Usage:  deploy.bat [commit message]
::         deploy.bat --check-only
::         deploy.bat --full       (full npm+nginx redeploy via deploy-vps.ps1)
:: ============================================================

cd /d "%~dp0"
set "PROJECT_ROOT=%CD%"

:: ---- Config ------------------------------------------------
set "VPS_HOST=hunterstar"
set "VPS_API_DIR=/opt/portfolio-api"
set "VPS_ADMIN_DIR=/var/www/admin-hunterstar"
set "PM2_APP=portfolio-api"
set "VPS_API_URL=https://api.hunterstar.uz"
set "SSH_OPTS=-o ConnectTimeout=20 -o ServerAliveInterval=15 -o StrictHostKeyChecking=no"

:: ---- Commit message ----------------------------------------
if /I "%~1"=="--check-only" goto check_only
if /I "%~1"=="--full" goto full_deploy

set "COMMIT_MSG=%~1"
if "!COMMIT_MSG!"=="" set "COMMIT_MSG=deploy"

echo.
echo  Hunterstar Fast Deploy
echo  ========================
echo  Root : %PROJECT_ROOT%
echo  VPS  : %VPS_HOST%
echo  App  : %PM2_APP%
echo  API  : %VPS_API_URL%
echo.

:: ---- Step 0: Git -------------------------------------------
echo [0/3] Vercel deploy...
call vercel --prod

if errorlevel 1 ( echo ERROR: Vercel deploy failed. & goto fail )

echo       Vercel OK.

:: ---- Step 1: Git -------------------------------------------
echo [1/3] Git commit + push...
git add -A
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "!COMMIT_MSG!"
    if errorlevel 1 ( echo ERROR: git commit failed. & goto fail )
) else (
    echo       No changes to commit.
)
git push
if errorlevel 1 ( echo ERROR: git push failed. & goto fail )
echo       Git OK.

:: ---- Step 2: SCP server.js and admin assets to VPS ---------
echo.
echo [2/3] Uploading api/server.js, admin static files, favicons, and assets to %VPS_HOST%...
ssh %SSH_OPTS% %VPS_HOST% "mkdir -p %VPS_ADMIN_DIR%/assets %VPS_ADMIN_DIR%/css %VPS_ADMIN_DIR%/js"
scp %SSH_OPTS% "%PROJECT_ROOT%\api\server.js" "%VPS_HOST%:%VPS_API_DIR%/server.js"
if errorlevel 1 ( echo ERROR: SCP server.js upload failed. & goto fail )
scp %SSH_OPTS% "%PROJECT_ROOT%\admin.html" "%VPS_HOST%:%VPS_ADMIN_DIR%/admin.html"
if errorlevel 1 ( echo ERROR: SCP admin.html upload failed. & goto fail )
scp %SSH_OPTS% "%PROJECT_ROOT%\css\admin-dashboard.css" "%VPS_HOST%:%VPS_ADMIN_DIR%/css/admin-dashboard.css"
scp %SSH_OPTS% "%PROJECT_ROOT%\css\styles.css" "%VPS_HOST%:%VPS_ADMIN_DIR%/css/styles.css"
scp %SSH_OPTS% "%PROJECT_ROOT%\js\admin.js" "%VPS_HOST%:%VPS_ADMIN_DIR%/js/admin.js"
scp %SSH_OPTS% "%PROJECT_ROOT%\js\firebase-config.js" "%VPS_HOST%:%VPS_ADMIN_DIR%/js/firebase-config.js"
scp %SSH_OPTS% "%PROJECT_ROOT%\favicon.ico" "%PROJECT_ROOT%\favicon-96x96.png" "%PROJECT_ROOT%\favicon.svg" "%PROJECT_ROOT%\apple-touch-icon.png" "%PROJECT_ROOT%\site.webmanifest" "%PROJECT_ROOT%\web-app-manifest-192x192.png" "%PROJECT_ROOT%\web-app-manifest-512x512.png" "%PROJECT_ROOT%\hunterstar.webp" "%VPS_HOST%:%VPS_ADMIN_DIR%/"
if errorlevel 1 ( echo ERROR: SCP favicons and manifests failed. & goto fail )
scp %SSH_OPTS% "%PROJECT_ROOT%\assets\logo.png" "%PROJECT_ROOT%\assets\hunterrealpic.png" "%PROJECT_ROOT%\assets\security-icon.webp" "%VPS_HOST%:%VPS_ADMIN_DIR%/assets/"
if errorlevel 1 ( echo ERROR: SCP assets failed. & goto fail )
echo       Upload OK.

:: ---- Step 3: Restart PM2 ------------------------------------
echo.
echo [3/3] Restarting PM2 app "%PM2_APP%"...
ssh %SSH_OPTS% %VPS_HOST% "pm2 restart %PM2_APP% && sleep 2 && pm2 show %PM2_APP% | grep -E 'status|uptime|restarts'"
if errorlevel 1 ( echo ERROR: PM2 restart failed. & goto fail )

:: ---- Health check -------------------------------------------
echo.
echo Verifying API health...
ssh %SSH_OPTS% %VPS_HOST% "curl -sf '%VPS_API_URL%/api/health' | python3 -m json.tool 2>/dev/null || curl -sf '%VPS_API_URL%/api/health'"
if errorlevel 1 (
    echo WARNING: Health check returned non-200. API may still be starting.
    echo          Check: %VPS_API_URL%/api/health
) else (
    echo.
    echo  Deploy complete^^!
    echo  API  : %VPS_API_URL%
    echo  Admin: https://admin.hunterstar.uz
)
echo.
goto end

:: ---- Full redeploy (npm install + nginx + ssl) --------------
:full_deploy
echo.
echo Running FULL VPS redeploy via deploy-vps.ps1...
echo (Use only when adding npm packages or changing nginx/ssl config)
echo.
set "COMMIT_MSG=%~2"
if "!COMMIT_MSG!"=="" set "COMMIT_MSG=deploy"
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $env:PROJECT_ROOT='%PROJECT_ROOT%'; $env:VPS_HOST='%VPS_HOST%'; $env:COMMIT_MSG='!COMMIT_MSG!'; & (Join-Path '%PROJECT_ROOT%' 'api\deploy-vps.ps1') }"
if errorlevel 1 goto fail
goto end

:: ---- Check-only mode ----------------------------------------
:check_only
echo Checking deploy prerequisites...
git --version >NUL 2>&1
if errorlevel 1 ( echo MISSING: git & exit /b 1 )
where ssh >NUL 2>&1
if errorlevel 1 ( echo MISSING: ssh & exit /b 1 )
where scp >NUL 2>&1
if errorlevel 1 ( echo MISSING: scp & exit /b 1 )
echo Testing SSH connection to %VPS_HOST%...
ssh %SSH_OPTS% %VPS_HOST% "echo SSH_OK"
if errorlevel 1 ( echo FAIL: Cannot SSH to %VPS_HOST% & exit /b 1 )
echo All checks passed.
exit /b 0

:fail
echo.
echo  Deploy FAILED. See errors above.
echo  Tip: run  deploy.bat --full [message]  for a full redeploy.
echo.
exit /b 1

:end
exit /b 0
