# Antigravity Tokens HUD - Windows Uninstaller
$ErrorActionPreference = "SilentlyContinue"

Write-Host "🛑 Uninstalling Antigravity Tokens HUD..." -ForegroundColor Yellow

$InstallDir = "$env:USERPROFILE\.antigravity-tokens-hud"
$localAppAntigravity = "$env:LOCALAPPDATA\Programs\Antigravity"
$antigravityExe = "$localAppAntigravity\Antigravity.exe"

# 1. Restore shortcuts
$wsh = New-Object -ComObject WScript.Shell
$shortcutsToRestore = @(
    "$env:USERPROFILE\Desktop\Antigravity.lnk",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Antigravity.lnk"
)

foreach ($scPath in $shortcutsToRestore) {
    if (Test-Path $scPath) {
        $sc = $wsh.CreateShortcut($scPath)
        $sc.TargetPath = $antigravityExe
        $sc.Arguments = ""
        $sc.IconLocation = "$antigravityExe,0"
        $sc.WorkingDirectory = $localAppAntigravity
        $sc.Description = "Google Antigravity"
        $sc.Save()
        Write-Host "✅ Restored shortcut: $scPath" -ForegroundColor Green
    }
}

# 2. Remove Task Scheduler task & Registry Run key
Unregister-ScheduledTask -TaskName "AntigravityTokensHUD" -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "AntigravityTokensHUD" -Force -ErrorAction SilentlyContinue
Write-Host "✅ Removed Scheduled Task and Registry Run key." -ForegroundColor Green

# 3. Remove Startup shortcuts
$startupFolder = [Environment]::GetFolderPath("Startup")
Remove-Item "$startupFolder\antigravity-tokens-hud.vbs" -Force -ErrorAction SilentlyContinue
Remove-Item "$startupFolder\antigravity-tokens-hud.lnk" -Force -ErrorAction SilentlyContinue
Write-Host "✅ Removed Startup shortcuts." -ForegroundColor Green

# 4. Stop running processes
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -like "*node*" -and $_.CommandLine -like "*antigravity-tokens-hud*"
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# 5. Remove install folder
if (Test-Path $InstallDir) {
    Remove-Item $InstallDir -Recurse -Force
    Write-Host "✅ Removed $InstallDir." -ForegroundColor Green
}

Write-Host "✨ Antigravity Tokens HUD completely uninstalled." -ForegroundColor Green
