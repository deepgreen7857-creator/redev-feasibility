# 윈도 작업 스케줄러에 '매일 새벽 1시 법원경매 수집'을 등록합니다. (PowerShell에서 이 폴더로 이동 후 실행)
#   powershell -ExecutionPolicy Bypass -File .\install-task.ps1
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ErrorActionPreference = "Stop"   # 등록이 실패하면 아래 "등록 완료"를 찍지 않고 멈춤
$node = (Get-Command node).Source
$action  = New-ScheduledTaskAction -Execute $node -Argument "src\run.js" -WorkingDirectory $dir
# 5시간 돌고 3시간 쉼: 01~06, 09~14, 17~22시 (config.json 의 allowedHours). 구간 시작마다 실행, 구간이 끝나면 스스로 멈춤
$trigger = @((New-ScheduledTaskTrigger -Daily -At 1:00am), (New-ScheduledTaskTrigger -Daily -At 9:00am), (New-ScheduledTaskTrigger -Daily -At 5:00pm))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 6) -MultipleInstances IgnoreNew -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "jbslab 법원경매 수집" -Action $action -Trigger $trigger -Settings $settings -Description "정비경매 리포트 법원경매 수집(사람 조회 속도)" -Force
Write-Host "등록 완료: 매일 01~06시, 09~14시, 17~22시 (하루 1,000화면에서 멈춤). 끄려면: Unregister-ScheduledTask -TaskName 'jbslab 법원경매 수집'"
