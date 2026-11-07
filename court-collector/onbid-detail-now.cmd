@echo off
rem Onbid: fetch missing details only (list already saved today). 2026-11-07
cd /d "%~dp0"
node src\onbid-bulk.cjs --detail-only
echo DONE> logs\onbid-now.done
echo Finished. You can close this window.
pause
