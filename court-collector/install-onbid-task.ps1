# 윈도 작업 스케줄러에 '공매 일괄 수집'을 등록합니다(매일 07:10, 19:10). PowerShell에서 이 폴더로 이동 후:
#   powershell -ExecutionPolicy Bypass -File .\install-onbid-task.ps1
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ErrorActionPreference = "Stop"
$node = (Get-Command node).Source
$action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$dir\공매받기.cmd`"" -WorkingDirectory $dir
$trigger = @((New-ScheduledTaskTrigger -Daily -At 7:10am), (New-ScheduledTaskTrigger -Daily -At 7:10pm))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 8) -MultipleInstances IgnoreNew -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "jbslab 공매 일괄 수집" -Action $action -Trigger $trigger -Settings $settings -Description "온비드 목록·원문·입찰결과 일괄 수집(공공데이터 API)" -Force
Write-Host "등록 완료: 매일 07:10, 19:10. 끄려면: Unregister-ScheduledTask -TaskName 'jbslab 공매 일괄 수집'"
