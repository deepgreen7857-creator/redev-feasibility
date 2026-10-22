# 윈도 작업 스케줄러에 '매일 새벽 1시 법원경매 수집'을 등록합니다. (PowerShell에서 이 폴더로 이동 후 실행)
#   powershell -ExecutionPolicy Bypass -File .\install-task.ps1
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ErrorActionPreference = "Stop"   # 등록이 실패하면 아래 "등록 완료"를 찍지 않고 멈춤
$node = (Get-Command node).Source
$action  = New-ScheduledTaskAction -Execute $node -Argument "src\run.js" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Daily -At 1:00am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 5) -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "jbslab 법원경매 수집" -Action $action -Trigger $trigger -Settings $settings -Description "정비경매 리포트 법원경매 수집(사람 조회 속도)" -Force
Write-Host "등록 완료: 매일 01:00 실행. 끄려면: Unregister-ScheduledTask -TaskName 'jbslab 법원경매 수집'"
