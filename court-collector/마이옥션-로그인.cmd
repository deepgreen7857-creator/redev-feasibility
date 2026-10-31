@echo off
chcp 65001 >nul
title 마이옥션 로그인(본인이 직접)
cd /d "%~dp0"
set PLAYWRIGHT_BROWSERS_PATH=0
node src\registry.js --login
echo.
echo 로그인이 저장되었으면 이 창을 닫으세요.
pause
