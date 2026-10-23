@echo off
rem Task Scheduler entry: pull latest repo first (continue even if it fails), then run the collector.
cd /d "%~dp0"
if not exist logs mkdir logs
echo [%date% %time%] git pull >> logs\update.log
git -C .. checkout -- court-collector/package-lock.json >> logs\update.log 2>&1
git -C .. pull --ff-only >> logs\update.log 2>&1
rem install new packages when package.json changed (pdf reader etc.)
call npm install --no-save --no-audit --no-fund >> logs\update.log 2>&1
node src\run.js
