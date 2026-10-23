# 윈도 작업 스케줄러에 '등기부 열람본 수집'을 등록합니다. (PowerShell에서 이 폴더로 이동 후 실행)
#   powershell -ExecutionPolicy Bypass -File .\install-registry-task.ps1
#  먼저 한 번: npm run myauction-login  (뜬 창에서 마이옥션 로그인 후 창 닫기)
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ErrorActionPreference = "Stop"
$node = (Get-Command node).Source
$action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$dir\start-registry.cmd`"" -WorkingDirectory $dir
# 08~23시 사이 천천히(물건 사이 1~2분), 하루 120건에서 멈춤. 중간에 꺼져도 14시에 다시 켜져 이어감(이미 돌고 있으면 그냥 끝남)
$trigger = @((New-ScheduledTaskTrigger -Daily -At 8:05am), (New-ScheduledTaskTrigger -Daily -At 2:05pm))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 15) -MultipleInstances IgnoreNew -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "jbslab 등기부 수집" -Action $action -Trigger $trigger -Settings $settings -Description "정비경매 리포트 등기부 열람본(마이옥션) 자료화 — 관리자 전용" -Force
Write-Host "등록 완료: 매일 08시(14시 재확인)부터 23시까지, 하루 120건. 끄려면: Unregister-ScheduledTask -TaskName 'jbslab 등기부 수집'"
