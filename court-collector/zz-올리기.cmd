@echo off
chcp 65001 >nul
rem 무료경매 수집기(muryo.js)와 관련 수정을 저장소에 올림 — 한 번 실행하면 끝(결과: logs\claude-git-muryo.txt)
cd /d "%~dp0"
set OUT=logs\claude-git-muryo.txt
echo === START %date% %time% > %OUT%
git -C .. add court-collector/src/muryo.js court-collector/src/hanmaum.js court-collector/한마음-로그인.cmd court-collector/지금시작-한마음.cmd court-collector/지금시작-무료경매.cmd court-collector/config.json court-collector/package.json court-collector/start-jauction.cmd court-collector/src/datasync.js court-collector/src/run.js court-collector/README.md court-collector/zz-올리기.cmd >> %OUT% 2>&1
git -C .. commit -m "한마음 로그인: 로그인 상태 유지 자동 체크(세션 끊김 방지)" >> %OUT% 2>&1
git -C .. pull --rebase >> %OUT% 2>&1
git -C .. push >> %OUT% 2>&1
git -C .. log --oneline -1 >> %OUT% 2>&1
echo === END %date% %time% >> %OUT%
type %OUT%
pause
