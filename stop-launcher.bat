@echo off
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :9876') do (taskkill /f /pid %%a 2>nul)
echo Launcher stopped.
