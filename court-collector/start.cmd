@echo off
rem 작업 스케줄러가 부르는 시작 파일: 먼저 저장소 최신판을 받고(실패해도 계속), 수집기를 돌린다.
cd /d "%~dp0"
if not exist logs mkdir logs
echo [%date% %time%] 최신판 받기 >> logs\update.log
git -C .. pull --ff-only >> logs\update.log 2>&1
node src\run.js
