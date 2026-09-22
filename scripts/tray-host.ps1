# Portboard system-tray host (Windows).
# Starts launch.mjs hidden, keeps a NotifyIcon in the tray.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $projectRoot "scripts\launch.mjs"))) {
  $projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
  $projectRoot = Split-Path -Parent $projectRoot
}

$statePath = Join-Path $env:TEMP "portboard-tray-state.json"
$logPath = Join-Path $env:TEMP "portboard-tray.log"
$launchPid = $null
$appContext = New-Object System.Windows.Forms.ApplicationContext

function Write-TrayLog([string]$Message) {
  $line = "{0} {1}" -f (Get-Date).ToString("o"), $Message
  Add-Content -Path $logPath -Value $line -Encoding UTF8
}

function Get-TrayState {
  if (-not (Test-Path $statePath)) { return $null }
  try {
    return Get-Content -Raw -Path $statePath | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Stop-PortboardProcess {
  param([int]$ProcessId)
  if ($ProcessId -gt 0) {
    Start-Process -FilePath "taskkill.exe" -ArgumentList @("/PID", "$ProcessId", "/T", "/F") -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
  }
}

function Start-PortboardHidden {
  if ($script:launchPid) {
    Stop-PortboardProcess -ProcessId $script:launchPid
    $script:launchPid = $null
  }

  $node = (Get-Command node -ErrorAction Stop).Source
  $launch = Join-Path $projectRoot "scripts\launch.mjs"
  $env:PORTBOARD_TRAY = "1"
  $env:PORTBOARD_STATE_PATH = $statePath
  $env:PORTBOARD_LOG_PATH = $logPath

  Write-TrayLog "starting hidden launch.mjs"
  $proc = Start-Process -FilePath $node -ArgumentList @($launch) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
  $script:launchPid = $proc.Id
  Write-TrayLog "launcher pid=$($proc.Id)"
  Update-TrayStatus
}

function Open-PortboardDashboard {
  $state = Get-TrayState
  if ($state -and $state.url) {
    Start-Process $state.url | Out-Null
    return
  }
  # Fallback: try the default port range
  Start-Process "http://127.0.0.1:43110" | Out-Null
}

function Update-TrayStatus {
  $state = Get-TrayState
  if ($state -and $state.status -eq "ready" -and $state.url) {
    $script:notify.Text = "Portboard - $($state.url)"
    $script:notify.BalloonTipTitle = "Portboard"
    $script:statusItem.Text = "Status: running on $($state.url)"
  } elseif ($state -and $state.status -eq "error") {
    $script:notify.Text = "Portboard - error"
    $script:statusItem.Text = "Status: error"
  } elseif ($state -and $state.status -eq "starting") {
    $script:notify.Text = "Portboard - starting..."
    $script:statusItem.Text = "Status: starting"
  } else {
    $script:notify.Text = "Portboard"
    $script:statusItem.Text = "Status: unknown"
  }
}

function Quit-PortboardTray {
  Write-TrayLog "quit requested"
  if ($script:launchPid) {
    Stop-PortboardProcess -ProcessId $script:launchPid
  }
  $state = Get-TrayState
  if ($state -and $state.pid) {
    Stop-PortboardProcess -ProcessId ([int]$state.pid)
  }
  $script:notify.Visible = $false
  $appContext.ExitThread()
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Application
$notify.Visible = $true
$notify.Text = "Portboard"
$notify.BalloonTipTitle = "Portboard"
$notify.BalloonTipText = "Portboard is starting..."
$notify.ShowBalloonTip(2000)

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = New-Object System.Windows.Forms.ToolStripMenuItem "Status: starting"
$statusItem.Enabled = $false
$openItem = New-Object System.Windows.Forms.ToolStripMenuItem "Open dashboard"
$restartItem = New-Object System.Windows.Forms.ToolStripMenuItem "Restart"
$quitItem = New-Object System.Windows.Forms.ToolStripMenuItem "Quit"

$openItem.Add_Click({ Open-PortboardDashboard })
$restartItem.Add_Click({
  Write-TrayLog "restart requested"
  Start-PortboardHidden
})
$quitItem.Add_Click({ Quit-PortboardTray })
$notify.Add_DoubleClick({ Open-PortboardDashboard })

[void]$menu.Items.Add($statusItem)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$menu.Items.Add($openItem)
[void]$menu.Items.Add($restartItem)
[void]$menu.Items.Add($quitItem)
$notify.ContextMenuStrip = $menu

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({ Update-TrayStatus })
$timer.Start()

Start-PortboardHidden

[System.Windows.Forms.Application]::Run($appContext)

$timer.Stop()
$notify.Visible = $false
$notify.Dispose()
