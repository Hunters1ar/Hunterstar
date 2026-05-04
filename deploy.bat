@echo off
setlocal EnableExtensions

cd /d "%~dp0"
set "PROJECT_ROOT=%CD%"
set "COMMIT_MSG=%~1"
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=fixed"

if /I "%~1"=="--check-only" goto check_only

echo [1/3] Launching Firebase functions deployment...
start "Functions Deploy" powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Set-Location -LiteralPath $env:PROJECT_ROOT; npm run deploy:functions; if ($LASTEXITCODE -ne 0) { throw 'Firebase functions deploy failed' }; Start-Sleep -Seconds 2; exit 0 } catch { Write-Host $_ -ForegroundColor Red; Start-Sleep -Seconds 10; exit 1 }"

echo [2/3] Launching Vercel production deployment...
start "Vercel Deploy" powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Set-Location -LiteralPath $env:PROJECT_ROOT; npm run deploy:vercel:prod; if ($LASTEXITCODE -ne 0) { throw 'Vercel deploy failed' }; Start-Sleep -Seconds 2; exit 0 } catch { Write-Host $_ -ForegroundColor Red; Start-Sleep -Seconds 10; exit 1 }"

echo [3/3] Launching GitHub production deployment...
start "GitHub Deploy" powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Set-Location -LiteralPath $env:PROJECT_ROOT; git add -A; if ($LASTEXITCODE -ne 0) { throw 'git add failed' }; git diff --cached --quiet; if ($LASTEXITCODE -eq 1) { git commit -m $env:COMMIT_MSG; if ($LASTEXITCODE -ne 0) { throw 'git commit failed' } } elseif ($LASTEXITCODE -gt 1) { throw 'git diff failed' }; git push; if ($LASTEXITCODE -ne 0) { throw 'git push failed' }; Start-Sleep -Seconds 2; exit 0 } catch { Write-Host $_ -ForegroundColor Red; Start-Sleep -Seconds 10; exit 1 }"

echo Task complete. All deployments are running in parallel and will close automatically upon completion.
exit /b 0

:check_only
echo Checking deploy shortcuts...
call npm run check
if errorlevel 1 exit /b 1
call npm run | findstr /C:"deploy:functions" >NUL
if errorlevel 1 exit /b 1
call npm run | findstr /C:"deploy:vercel:prod" >NUL
if errorlevel 1 exit /b 1
echo deploy:functions and deploy:vercel:prod scripts exist.
exit /b 0
