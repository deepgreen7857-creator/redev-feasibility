@echo off
rem Onbid bulk collector (list + detail + results) - same as the Korean-named cmd. Logs: logs\onbid-YYYYMMDD.log
cd /d "%~dp0"
if not exist logs mkdir logs
echo [%date% %time%] git pull >> logs\update.log
git -C .. pull --ff-only >> logs\update.log 2>&1
call npm install --no-save --no-audit --no-fund >> logs\update.log 2>&1
node src\onbid-bulk.cjs
