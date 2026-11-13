@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js LTS first: https://nodejs.org & pause & exit /b 1)
call npm install || (echo npm install failed & pause & exit /b 1)
call npm run dist || (echo build failed & pause & exit /b 1)
echo.
echo DONE. Your .exe files are in the "dist" folder.
explorer dist
pause
