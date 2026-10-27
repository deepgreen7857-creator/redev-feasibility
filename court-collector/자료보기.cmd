@echo off
chcp 65001 >nul
title 경매 자료 보기
cd /d "%~dp0"
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8787"
node src\viewer.js
pause
