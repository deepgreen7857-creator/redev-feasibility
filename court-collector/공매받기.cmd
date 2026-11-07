@echo off
chcp 65001 >nul
rem 공매(온비드) 일괄 수집 — 목록·원문·입찰결과를 한 번에 받아 파일 저장 후 사이트에 올림 (2026-11-07)
rem 원자료: D:\공매원본\날짜\ (D: 없으면 state\onbid\날짜\), 기록: logs\onbid-날짜.log
cd /d "%~dp0"
if not exist logs mkdir logs
echo [%date% %time%] git pull >> logs\update.log
git -C .. pull --ff-only >> logs\update.log 2>&1
call npm install --no-save --no-audit --no-fund >> logs\update.log 2>&1
node src\onbid-bulk.cjs
