@echo off
rem Task Scheduler entry: 제이옥션 자료(감정평가서·명세서·현황조사서·사진) 사건번호별 보관. Pull latest repo first (review/items.json), then run.
cd /d "%~dp0"
if not exist logs mkdir logs
echo [%date% %time%] git pull (jauction) >> logs\update.log
git -C .. checkout -- court-collector/package-lock.json >> logs\update.log 2>&1
git -C .. pull --ff-only >> logs\update.log 2>&1
node src\jauction.js
rem 받은 자료를 jbslab.co.kr/data(관리자 전용)에 올림
node src\datasync.js
