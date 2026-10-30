@echo off
chcp 65001 >nul
title 한마음경매 자료 받기(지금 시작)
cd /d "%~dp0"
node src\hanmaum.js
pause
