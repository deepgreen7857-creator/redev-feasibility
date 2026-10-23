@echo off
rem Task Scheduler entry: registry (myauction) collector. Pull latest repo first, then run.
cd /d "%~dp0"
if not exist logs mkdir logs
echo [%date% %time%] git pull (registry) >> logs\update.log
git -C .. checkout -- court-collector/package-lock.json >> logs\update.log 2>&1
git -C .. pull --ff-only >> logs\update.log 2>&1
call npm install --no-save --no-audit --no-fund >> logs\update.log 2>&1
node src\registry.js