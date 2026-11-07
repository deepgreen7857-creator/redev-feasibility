@echo off
rem Run onbid bulk collector on the laptop now (2026-11-07).
rem  - If .env is missing, read the ingest token from Firebase secret (laptop firebase login) into .env (not shown on screen)
rem  - If the server does not know the new onbid actions yet (exit code 3), deploy functions once and run again
cd /d "%~dp0"
if not exist logs mkdir logs
if not exist .env (
  echo [setup] reading ingest token from Firebase secret...
  for /f "delims=" %%t in ('firebase functions:secrets:access COURT_INGEST_TOKEN --project jbslab-auction 2^>nul') do set "TOK=%%t"
)
if not exist .env (
  if not defined TOK ( echo [setup] could not read token. & goto :end )
  > .env echo INGEST_URL=https://asia-northeast3-jbslab-auction.cloudfunctions.net/ingestCourt
  >> .env echo INGEST_TOKEN=%TOK%
  set "TOK="
  echo [setup] .env written.
)
echo [setup] installing packages...
call npm install --no-save --no-audit --no-fund fast-xml-parser@^4.5.0 >> logs\update.log 2>&1
node src\onbid-bulk.cjs
if %errorlevel%==3 (
  echo [deploy] server is old - deploying functions...
  pushd ..\auction-server
  call firebase deploy --only functions --project jbslab-auction > ..\court-collector\logs\deploy-now.txt 2>&1
  popd
  echo [run] collecting again...
  node src\onbid-bulk.cjs
)
:end
echo DONE> logs\onbid-now.done
echo Finished. You can close this window.
pause
