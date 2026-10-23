@echo off
rem Task Scheduler entry: pull latest repo first (continue even if it fails), then run the collector.
cd /d "%~dp0"
if not exist logs mkdir logs
echo [%date% %time%] git pull >> logs\update.log
git -C .. pull --ff-only >> logs\update.log 2>&1
node src\run.js
