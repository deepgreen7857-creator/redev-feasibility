# 윈도 작업 스케줄러에 'review 후보 감정평가서 받기(제이옥션)'를 등록합니다. (PowerShell에서 이 폴더로 이동 후 실행)
#   powershell -ExecutionPolicy Bypass -File .\install-jauction-task.ps1
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ErrorActionPreference = "Stop"
$action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$dir\start-jauction.cmd`"" -WorkingDirectory $dir
# 하루 네 번(01:30, 07:40, 13:50, 19:55) 깨어나 24시간 이어서 받음(한 번에 최대 6시간)(하루 한도·속도는 config.json jauction). 이미 돌고 있으면 그냥 끝남
$trigger = @((New-ScheduledTaskTrigger -Daily -At 1:30am), (New-ScheduledTaskTrigger -Daily -At 7:40am), (New-ScheduledTaskTrigger -Daily -At 1:50pm), (New-ScheduledTaskTrigger -Daily -At 7:55pm))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 6) -MultipleInstances IgnoreNew -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "jbslab 제이옥션 자료 받기" -Action $action -Trigger $trigger -Settings $settings -Description "집중 지역·review 후보 사건의 제이옥션 자료(감정평가서·명세서·현황조사서·사진)를 원본 하드에 보관(사이트에는 안 올림)" -Force
Write-Host "등록 완료: 매일 01:30·07:40·13:50·19:55(24시간 이어서 받음). 끄려면: Unregister-ScheduledTask -TaskName 'jbslab 제이옥션 자료 받기'"
