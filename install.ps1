# Antigravity Tokens HUD - Windows Installer
$ErrorActionPreference = "Stop"

$RepoRawUrl = "https://raw.githubusercontent.com/quazovsky/antigravity-tokens-hud/main"
$InstallDir = "$env:USERPROFILE\.antigravity-tokens-hud"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  🚀 Antigravity Tokens HUD Installer     " -ForegroundColor Cyan
Write-Host "  Real-time Token & Quota Visualizer      " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Antigravity 2.0
Write-Host "🔍 Checking for Google Antigravity 2.0..." -ForegroundColor Yellow
$appDataAntigravity = "$env:APPDATA\Antigravity"
$localAppAntigravity = "$env:LOCALAPPDATA\Programs\Antigravity"
$antigravityExe = "$localAppAntigravity\Antigravity.exe"

if (-not (Test-Path $appDataAntigravity) -and -not (Test-Path $localAppAntigravity)) {
    Write-Host ""
    Write-Host "❌ Google Antigravity 2.0 is not installed!" -ForegroundColor Red
    Write-Host "👉 Please install Antigravity 2.0 first: https://antigravity.google/download" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
Write-Host "✅ Antigravity 2.0 detected." -ForegroundColor Green

# 2. Check and automatically install Node.js
Write-Host "🔍 Checking Node.js..." -ForegroundColor Yellow
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$needNodeInstall = $false
$needNodeUpdate = $false

if (-not $nodeCmd) {
    $needNodeInstall = $true
} else {
    try {
        $nodeVerStr = (node -v) -replace 'v',''
        $nodeMajor = [int]($nodeVerStr.Split('.')[0])
        if ($nodeMajor -lt 18) {
            $needNodeUpdate = $true
        }
    } catch {
        $needNodeInstall = $true
    }
}

if ($needNodeInstall) {
    Write-Host "⚠️ Node.js is not found. Starting automatic installation..." -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "📦 Installing Node.js LTS via winget..." -ForegroundColor Cyan
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        choco install nodejs-lts -y
    } elseif (Get-Command scoop -ErrorAction SilentlyContinue) {
        scoop install nodejs-lts
    } else {
        Write-Host "⬇️ Downloading Node.js installer..." -ForegroundColor Cyan
        $msiUrl = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi"
        $msiPath = "$env:TEMP\node_setup.msi"
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
        Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn" -Wait
        Remove-Item $msiPath -Force
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} elseif ($needNodeUpdate) {
    Write-Host "⚠️ Node.js version is below v18. Updating..." -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget upgrade OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
    $nodePath = "node"
}
Write-Host "✅ Node.js ready: $nodePath" -ForegroundColor Green

# 3. Check and install Python 3
Write-Host "🔍 Checking Python 3..." -ForegroundColor Yellow
$pyCmd = Get-Command python -ErrorAction SilentlyContinue
$needPyInstall = $false
$needPyUpdate = $false

if (-not $pyCmd) {
    $pyCmd = Get-Command python3 -ErrorAction SilentlyContinue
}

if (-not $pyCmd) {
    $needPyInstall = $true
} else {
    try {
        $pyVerStr = & $pyCmd.Source -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
        $pyMajor = [int]($pyVerStr.Split('.')[0])
        $pyMinor = [int]($pyVerStr.Split('.')[1])
        if ($pyMajor -lt 3 -or ($pyMajor -eq 3 -and $pyMinor -lt 8)) {
            $needPyUpdate = $true
        }
    } catch {
        $needPyInstall = $true
    }
}

if ($needPyInstall) {
    Write-Host "⚠️ Python 3 is not found. Installing Python 3.12..." -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
    } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        choco install python3 -y
    } elseif (Get-Command scoop -ErrorAction SilentlyContinue) {
        scoop install python
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}
Write-Host "✅ Python 3 ready." -ForegroundColor Green

# 4. Download / Install files
Write-Host "📦 Installing files to $InstallDir..." -ForegroundColor Yellow
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$files = @("index.js", "client_widget.js", "token_stats.py", "package.json", "uninstall.ps1")
foreach ($f in $files) {
    if (Test-Path "$PSScriptRoot\$f") {
        Copy-Item "$PSScriptRoot\$f" "$InstallDir\$f" -Force
    } else {
        Invoke-WebRequest -Uri "$RepoRawUrl/$f" -OutFile "$InstallDir\$f" -UseBasicParsing
    }
}

# Set English config
Set-Content -Path "$InstallDir\config.json" -Value '{"lang":"en"}'

# 5. Generate run-hud.vbs and launch-antigravity.vbs with exact resolved paths
$runHudVbsContent = "CreateObject(`"Wscript.Shell`").Run `"`"`"$nodePath`"`" `"`"$InstallDir\index.js`"`"`, 0, False`r`n"
[System.IO.File]::WriteAllText("$InstallDir\run-hud.vbs", $runHudVbsContent, [System.Text.Encoding]::UTF8)

$launchAntigravityVbs = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """$nodePath"" ""$InstallDir\index.js""", 0, False
Dim args, i
args = ""
For i = 0 To WScript.Arguments.Count - 1
    args = args & " """ & WScript.Arguments(i) & """"
Next
WshShell.Run """$antigravityExe""" & args, 1, False
"@
[System.IO.File]::WriteAllText("$InstallDir\launch-antigravity.vbs", $launchAntigravityVbs, [System.Text.Encoding]::UTF8)

# 6. Hook Antigravity shortcuts to automatically launch HUD with Antigravity
Write-Host "⚙️ Hooking Antigravity shortcuts for automatic launch..." -ForegroundColor Yellow
$wsh = New-Object -ComObject WScript.Shell
$shortcutsToHook = @(
    "$env:USERPROFILE\Desktop\Antigravity.lnk",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Antigravity.lnk"
)

foreach ($scPath in $shortcutsToHook) {
    if (Test-Path $scPath) {
        $sc = $wsh.CreateShortcut($scPath)
        $sc.TargetPath = "wscript.exe"
        $sc.Arguments = "`"$InstallDir\launch-antigravity.vbs`""
        $sc.IconLocation = "$antigravityExe,0"
        $sc.WorkingDirectory = "$localAppAntigravity"
        $sc.Description = "Google Antigravity with Tokens HUD"
        $sc.Save()
        Write-Host "✅ Hooked shortcut: $scPath" -ForegroundColor Green
    }
}

# 7. Configure Windows Autostart (Registry Run key + Startup folder + Task Scheduler)
Write-Host "⚙️ Configuring background persistence..." -ForegroundColor Yellow

# Registry Run Key (Guaranteed user-level autostart on Windows logon)
try {
    $regRunCmd = "wscript.exe `"$InstallDir\run-hud.vbs`""
    Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "AntigravityTokensHUD" -Value $regRunCmd -Force -ErrorAction SilentlyContinue
    Write-Host "✅ Registry Run key autostart configured." -ForegroundColor Green
} catch {}

# Windows Startup folder
try {
    $startupFolder = [Environment]::GetFolderPath("Startup")
    Remove-Item "$startupFolder\antigravity-tokens-hud.vbs" -Force -ErrorAction SilentlyContinue
    $startupLnk = "$startupFolder\antigravity-tokens-hud.lnk"
    $scStart = $wsh.CreateShortcut($startupLnk)
    $scStart.TargetPath = "wscript.exe"
    $scStart.Arguments = "`"$InstallDir\run-hud.vbs`""
    $scStart.WorkingDirectory = $InstallDir
    $scStart.Description = "Antigravity Tokens HUD Background Daemon"
    $scStart.Save()
    Write-Host "✅ Startup folder shortcut created." -ForegroundColor Green
} catch {}

# Scheduled Task (if permissions allow)
try {
    $action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$InstallDir\run-hud.vbs`"" -WorkingDirectory $InstallDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 365) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName "AntigravityTokensHUD" -Action $action -Trigger $trigger -Settings $settings -Force -ErrorAction SilentlyContinue | Out-Null
    Start-ScheduledTask -TaskName "AntigravityTokensHUD" -ErrorAction SilentlyContinue | Out-Null
} catch {}

# 8. Start background HUD daemon now
Start-Process -FilePath "wscript.exe" -ArgumentList "`"$InstallDir\run-hud.vbs`""

Start-Sleep -Seconds 2
$running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -like "*node*" -and $_.CommandLine -like "*antigravity-tokens-hud*"
}
if (-not $running) {
    $running = Get-Process node -ErrorAction SilentlyContinue
}

if ($running) {
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "🎉 SUCCESS! Antigravity Tokens HUD is ready!" -ForegroundColor Green
    Write-Host "✨ HUD will automatically start whenever Antigravity is opened." -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "⚠️ Warning: HUD background process did not start automatically." -ForegroundColor Yellow
    Write-Host "👉 You can launch it manually: node `"$InstallDir\index.js`"" -ForegroundColor Yellow
}
