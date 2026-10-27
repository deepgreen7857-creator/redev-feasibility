@echo off
chcp 65001 >nul
title 제이옥션 자료 받기 (지금 시작)
cd /d "%~dp0"
node src\jauction.js --now
echo.
echo 끝났습니다. 이 창은 닫아도 됩니다.
pause
