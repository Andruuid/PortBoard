$ErrorActionPreference = "Stop"

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$listeners = @(Get-NetTCPConnection -State Listen | ForEach-Object {
  [PSCustomObject]@{
    localAddress = $_.LocalAddress
    localPort = [int]$_.LocalPort
    owningProcess = [int]$_.OwningProcess
  }
})

$cimProcesses = @(Get-CimInstance Win32_Process)
$processes = @($cimProcesses | ForEach-Object {
  $createdAt = $null
  if ($_.CreationDate) {
    $createdAt = $_.CreationDate.ToUniversalTime().ToString("o")
  }

  [PSCustomObject]@{
    processId = [int]$_.ProcessId
    parentProcessId = [int]$_.ParentProcessId
    name = $_.Name
    executablePath = $_.ExecutablePath
    commandLine = $_.CommandLine
    createdAt = $createdAt
  }
})

$processById = @{}
foreach ($process in $cimProcesses) {
  $processById[[int]$process.ProcessId] = $process
}

$owners = [ordered]@{}
$candidateIds = @($listeners | Select-Object -ExpandProperty owningProcess -Unique)
foreach ($candidateId in $candidateIds) {
  if (-not $processById.ContainsKey([int]$candidateId)) {
    continue
  }

  $candidate = $processById[[int]$candidateId]
  if ($candidate.Name -notin @("node.exe", "bun.exe")) {
    continue
  }

  try {
    $owner = Invoke-CimMethod -InputObject $candidate -MethodName GetOwner
    if ($owner.ReturnValue -eq 0) {
      $owners[[string]$candidateId] = "$($owner.Domain)\$($owner.User)"
    }
  }
  catch {
    # Inaccessible processes are omitted by design.
  }
}

[PSCustomObject]@{
  currentIdentity = $currentIdentity
  listeners = $listeners
  processes = $processes
  owners = $owners
} | ConvertTo-Json -Depth 6 -Compress
