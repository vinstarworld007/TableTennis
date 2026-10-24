@echo off
title Monday Night Club server
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org && pause && exit /b)
if not exist node_modules (echo Installing for the first time... && call npm install --omit=dev)
call npm start
pause
