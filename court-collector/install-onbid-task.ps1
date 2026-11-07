# Register Windows scheduled task "jbslab onbid bulk" (daily 07:10 and 19:10).
#   powershell -ExecutionPolicy Bypass -File .\install-onbid-task.ps1
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ErrorActionPreference = "Stop"
$node = (Get-Command node).Source
$action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$dir\onbid-run.cmd`"" -WorkingDirectory $dir
$trigger = @((New-ScheduledTaskTrigger -Daily -At 7:10am), (New-ScheduledTaskTrigger -Daily -At 7:10pm))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 8) -MultipleInstances IgnoreNew -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "jbslab onbid bulk" -Action $action -Trigger $trigger -Settings $settings -Description "Onbid list/detail/result bulk collect (data.go.kr API)" -Force
Write-Host "OK: daily 07:10, 19:10. Remove: Unregister-ScheduledTask -TaskName 'jbslab onbid bulk'"
