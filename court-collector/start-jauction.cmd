@echo off
rem Task Scheduler entry: 제이옥션 자료(감정평가서·명세서·현황조사서·사진) 사건번호별 보관. Pull latest repo first (review/items.json), then run.
cd /d "%~dp0"
if not exist logs mkdir logs
echo [%date% %time%] git pull (jauction) >> logs\update.log
git -C .. checkout -- court-collector/package-lock.json >> logs\update.log 2>&1
git -C .. pull --ff-only >> logs\update.log 2>&1
rem 무료경매.kr(제일법원경매) 수집기를 따로 띄움 — 제이옥션과 다른 사이트라 같이 돌아도 됨(이미 돌고 있으면 스스로 끝남)
start "" /b node src\muryo.js
rem 한마음경매: 감정평가서·명세서 PDF와 사진을 채움(무료경매.kr 로 못 받는 것)
start "" /b node src\hanmaum.js
node src\jauction.js
rem 받은 자료를 jbslab.co.kr/data(관리자 전용)에 올림
node src\datasync.js
