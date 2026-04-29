@echo off
setlocal

cd /d "%~dp0"

echo Starting interactive setup...
call npm run setup
if errorlevel 1 goto :error
exit /b 0

:error
echo Setup failed.
exit /b 1
