# Antigravity Tokens HUD - Windows Установщик (Русская версия)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$RepoRawUrl = "https://raw.githubusercontent.com/quazovsky/antigravity-tokens-hud/main"
$InstallDir = "$env:USERPROFILE\.antigravity-tokens-hud"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  🚀 Antigravity Tokens HUD (Русская версия)" -ForegroundColor Cyan
Write-Host "  Виджет контекста и лимитов в реальном времени" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Проверка Antigravity 2.0
Write-Host "🔍 Проверка наличия Google Antigravity 2.0..." -ForegroundColor Yellow
$appDataAntigravity = "$env:APPDATA\Antigravity"
$localAppAntigravity = "$env:LOCALAPPDATA\Programs\Antigravity"
$antigravityExe = "$localAppAntigravity\Antigravity.exe"

if (-not (Test-Path $appDataAntigravity) -and -not (Test-Path $localAppAntigravity)) {
    Write-Host ""
    Write-Host "❌ Google Antigravity 2.0 не установлена!" -ForegroundColor Red
    Write-Host "👉 Установите Antigravity 2.0: https://antigravity.google/download" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
Write-Host "✅ Antigravity 2.0 обнаружена." -ForegroundColor Green

# 2. Проверка и автоматическая установка Node.js
Write-Host "🔍 Проверка Node.js..." -ForegroundColor Yellow
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
    Write-Host "⚠️ Node.js не найден. Начинаем автоматическую установку..." -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "📦 Установка Node.js LTS через winget..." -ForegroundColor Cyan
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        choco install nodejs-lts -y
    } elseif (Get-Command scoop -ErrorAction SilentlyContinue) {
        scoop install nodejs-lts
    } else {
        Write-Host "⬇️ Скачивание установщика Node.js..." -ForegroundColor Cyan
        $msiUrl = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi"
        $msiPath = "$env:TEMP\node_setup.msi"
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
        Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn" -Wait
        Remove-Item $msiPath -Force
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} elseif ($needNodeUpdate) {
    Write-Host "⚠️ Версия Node.js ниже v18. Выполняем обновление..." -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget upgrade OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
    $nodePath = "node"
}
Write-Host "✅ Node.js готов к работе: $nodePath" -ForegroundColor Green

# 3. Проверка Python 3
Write-Host "🔍 Проверка Python 3..." -ForegroundColor Yellow
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
    Write-Host "⚠️ Python 3 не найден. Устанавливаем Python 3.12..." -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
    } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        choco install python3 -y
    } elseif (Get-Command scoop -ErrorAction SilentlyContinue) {
        scoop install python
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}
Write-Host "✅ Python 3 готов." -ForegroundColor Green

# 4. Скачивание / Копирование файлов
Write-Host "📦 Установка файлов в $InstallDir..." -ForegroundColor Yellow
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

# Установка русского языка по умолчанию
Set-Content -Path "$InstallDir\config.json" -Value '{"lang":"ru"}'

# 5. Генерация run-hud.vbs и launch-antigravity.vbs
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

# 6. Привязка ярлыков Antigravity к автозапуску HUD
Write-Host "⚙️ Настройка ярлыков Antigravity для автоматического запуска..." -ForegroundColor Yellow
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
        Write-Host "✅ Ярлык обновлен: $scPath" -ForegroundColor Green
    }
}

# 7. Настройка Планировщика задач Windows и Автозагрузки
Write-Host "⚙️ Настройка фоновой службы..." -ForegroundColor Yellow
try {
    $action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$InstallDir\run-hud.vbs`"" -WorkingDirectory $InstallDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 365) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName "AntigravityTokensHUD" -Action $action -Trigger $trigger -Settings $settings -Force -ErrorAction SilentlyContinue | Out-Null
    Start-ScheduledTask -TaskName "AntigravityTokensHUD" -ErrorAction SilentlyContinue | Out-Null
    Write-Host "✅ Задача в Планировщике Windows создана и запущена." -ForegroundColor Green
} catch {}

$startupFolder = [Environment]::GetFolderPath("Startup")
$startupLnk = "$startupFolder\antigravity-tokens-hud.lnk"
$scStart = $wsh.CreateShortcut($startupLnk)
$scStart.TargetPath = "wscript.exe"
$scStart.Arguments = "`"$InstallDir\run-hud.vbs`""
$scStart.WorkingDirectory = $InstallDir
$scStart.Description = "Antigravity Tokens HUD Background Daemon"
$scStart.Save()
Write-Host "✅ Ярлык автозагрузки создан." -ForegroundColor Green

# 8. Запуск фоновой службы прямо сейчас
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
    Write-Host "🎉 ГОТОВО! Antigravity Tokens HUD успешно установлен!" -ForegroundColor Green
    Write-Host "✨ HUD будет автоматически запускаться при каждом открытии Antigravity." -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "⚠️ Служба запущена. При открытии Antigravity виджет появится автоматически." -ForegroundColor Yellow
}
