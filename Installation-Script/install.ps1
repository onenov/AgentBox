$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

try {
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  if (Get-Command chcp.com -ErrorAction SilentlyContinue) {
    chcp.com 65001 | Out-Null
  }
  [Console]::OutputEncoding = $utf8NoBom
  [Console]::InputEncoding = $utf8NoBom
  $OutputEncoding = $utf8NoBom
} catch {
}

$AgentBoxManifestUrl = "https://agent.orence.net/releases/latest.json"
$AgentBoxArch = "auto"
$AgentBoxDownloadDir = Join-Path $env:TEMP "AgentBoxInstall"
$AgentBoxInstallerPath = ""
$AgentBoxSilent = $false
$AgentBoxWait = $false
$AgentBoxNoRun = $false
$AgentBoxForce = $false
$AgentBoxDryRun = $false
$AgentBoxCat = $false
$AgentBoxUninstall = $false
$AgentBoxCurrentUser = $false
$AgentBoxAllUsers = $false
$AgentBoxHelp = $false

function Show-AgentBoxHelp {
  @"
AgentBox Windows Installer

Usage:
  irm https://agent.orence.net/install.ps1 | iex
  & ([scriptblock]::Create((irm https://agent.orence.net/install.ps1))) [options]

Options:
  -ManifestUrl URL     Use a custom release manifest. Default: https://agent.orence.net/releases/latest.json
  -Arch auto|x64|arm64 Select the Windows installer architecture. Default: auto
  -DownloadDir DIR     Installer download directory. Default: %TEMP%\AgentBoxInstall
  -InstallerPath FILE  Use a local installer file and skip download.
  -Silent              Silent install. Passes NSIS /S.
  -Wait                Wait for the installer to exit.
  -NoRun               Download only. Do not start the installer.
  -Force               Redownload even if the installer already exists.
  -DryRun              Print the plan only. Do not download or install.
  -Cat                 Show current Windows install status.
  -Uninstall           Run the installed AgentBox uninstaller.
  -CurrentUser         Install for current user. Passes /currentuser.
  -AllUsers            Install for all users. Passes /allusers.
  -Help                Show help.

Compatible option names:
  --manifest-url, --arch, --download-dir, --installer-path, --silent, --wait,
  --no-run, --force, --dry-run, --cat, --uninstall, --current-user, --all-users, --help
"@
}

function Fail-AgentBox {
  param([string]$Message)
  Write-Host "Error: $Message" -ForegroundColor Red
  exit 1
}

function Write-AgentBoxTitle {
  param([string]$Text)
  Write-Host ""
  Write-Host "============================================================" -ForegroundColor DarkGray
  Write-Host $Text -ForegroundColor Cyan
  Write-Host "============================================================" -ForegroundColor DarkGray
}

function Write-AgentBoxSection {
  param([string]$Text)
  Write-Host ""
  Write-Host $Text -ForegroundColor Cyan
  Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray
}

function Write-AgentBoxStep {
  param([string]$Text)
  Write-Host ""
  Write-Host "==> $Text" -ForegroundColor Yellow
}

function Write-AgentBoxInfo {
  param([string]$Text)
  Write-Host "  - $Text"
}

function Write-AgentBoxOk {
  param([string]$Text)
  Write-Host "Done: $Text" -ForegroundColor Green
}

function Read-AgentBoxValue {
  param(
    [string[]]$Arguments,
    [int]$Index,
    [string]$Name
  )

  if ($Index + 1 -ge $Arguments.Count) {
    Fail-AgentBox "$Name requires a value."
  }
  return $Arguments[$Index + 1]
}

$argv = @($args)
for ($i = 0; $i -lt $argv.Count; $i++) {
  $arg = [string]$argv[$i]
  switch -Regex ($arg) {
    '^(--help|-help|-h|/\?)$' {
      $AgentBoxHelp = $true
      continue
    }
    '^(--cat|--status|-cat|-status)$' {
      $AgentBoxCat = $true
      continue
    }
    '^(--uninstall|-uninstall)$' {
      $AgentBoxUninstall = $true
      continue
    }
    '^(--silent|-silent)$' {
      $AgentBoxSilent = $true
      continue
    }
    '^(--wait|-wait)$' {
      $AgentBoxWait = $true
      continue
    }
    '^(--no-run|-norun|-no-run)$' {
      $AgentBoxNoRun = $true
      continue
    }
    '^(--force|-force)$' {
      $AgentBoxForce = $true
      continue
    }
    '^(--dry-run|-dryrun|-dry-run)$' {
      $AgentBoxDryRun = $true
      continue
    }
    '^(--current-user|-currentuser|-current-user)$' {
      $AgentBoxCurrentUser = $true
      continue
    }
    '^(--all-users|-allusers|-all-users)$' {
      $AgentBoxAllUsers = $true
      continue
    }
    '^(--manifest-url|-manifesturl|-manifest-url)$' {
      $AgentBoxManifestUrl = Read-AgentBoxValue $argv $i $arg
      $i++
      continue
    }
    '^(--manifest-url|-manifesturl|-manifest-url)=(.+)$' {
      $AgentBoxManifestUrl = $Matches[2]
      continue
    }
    '^(--arch|-arch)$' {
      $AgentBoxArch = Read-AgentBoxValue $argv $i $arg
      $i++
      continue
    }
    '^(--arch|-arch)=(.+)$' {
      $AgentBoxArch = $Matches[2]
      continue
    }
    '^(--download-dir|-downloaddir|-download-dir)$' {
      $AgentBoxDownloadDir = Read-AgentBoxValue $argv $i $arg
      $i++
      continue
    }
    '^(--download-dir|-downloaddir|-download-dir)=(.+)$' {
      $AgentBoxDownloadDir = $Matches[2]
      continue
    }
    '^(--installer-path|-installerpath|-installer-path)$' {
      $AgentBoxInstallerPath = Read-AgentBoxValue $argv $i $arg
      $i++
      continue
    }
    '^(--installer-path|-installerpath|-installer-path)=(.+)$' {
      $AgentBoxInstallerPath = $Matches[2]
      continue
    }
    default {
      Fail-AgentBox "Unknown option: $arg. Use -Help for usage."
    }
  }
}

if ($AgentBoxHelp) {
  Show-AgentBoxHelp
  exit 0
}

if ($AgentBoxCurrentUser -and $AgentBoxAllUsers) {
  Fail-AgentBox "-CurrentUser and -AllUsers cannot be used together."
}

function Enable-AgentBoxTls {
  try {
    [Net.ServicePointManager]::SecurityProtocol = `
      [Net.SecurityProtocolType]::Tls12 -bor `
      [Net.SecurityProtocolType]::Tls11 -bor `
      [Net.SecurityProtocolType]::Tls
  } catch {
  }
}

function Invoke-AgentBoxWebRequest {
  param(
    [string]$Uri,
    [string]$OutFile
  )

  Enable-AgentBoxTls
  $parameters = @{
    Uri = $Uri
    ErrorAction = "Stop"
  }
  if ($PSVersionTable.PSVersion.Major -lt 6) {
    $parameters.UseBasicParsing = $true
  }
  if ($OutFile) {
    $parameters.OutFile = $OutFile
  }
  Invoke-WebRequest @parameters
}

function Read-AgentBoxManifest {
  param([string]$Url)

  $response = Invoke-AgentBoxWebRequest -Uri $Url -OutFile $null
  return $response.Content | ConvertFrom-Json
}

function Resolve-AgentBoxArch {
  param([string]$RequestedArch)

  switch ($RequestedArch.ToLowerInvariant()) {
    "x64" { return "x64" }
    "amd64" { return "x64" }
    "x86_64" { return "x64" }
    "arm64" { return "arm64" }
    "aarch64" { return "arm64" }
    "auto" {
      $machineArch = $env:PROCESSOR_ARCHITEW6432
      if (-not $machineArch) {
        $machineArch = $env:PROCESSOR_ARCHITECTURE
      }
      switch -Regex ($machineArch) {
        "ARM64" { return "arm64" }
        "AMD64|IA64|x64" { return "x64" }
        default { Fail-AgentBox "Unsupported Windows architecture: $machineArch" }
      }
    }
    default {
      Fail-AgentBox "Unsupported architecture option: $RequestedArch. Use auto, x64, or arm64."
    }
  }
}

function Get-AgentBoxPlatformKey {
  param([string]$Arch)

  switch ($Arch) {
    "x64" { return "windows-x86_64" }
    "arm64" { return "windows-aarch64" }
    default { Fail-AgentBox "Unsupported Windows architecture: $Arch" }
  }
}

function Get-AgentBoxPlatform {
  param(
    $Manifest,
    [string]$PlatformKey
  )

  $platforms = Get-AgentBoxRawProperty $Manifest "platforms"
  if (-not $platforms) {
    Fail-AgentBox "Release manifest is missing the platforms field."
  }

  $property = $platforms.PSObject.Properties | Where-Object { $_.Name -eq $PlatformKey } | Select-Object -First 1
  if (-not $property) {
    Fail-AgentBox "Release manifest is missing the $PlatformKey installer."
  }
  return $property.Value
}

function Get-AgentBoxInstallerFileName {
  param(
    [string]$Url,
    [string]$Version,
    [string]$Arch
  )

  try {
    $fileName = [IO.Path]::GetFileName(([Uri]$Url).AbsolutePath)
    if ($fileName) {
      return $fileName
    }
  } catch {
  }
  return "AgentBox_${Version}_${Arch}-setup.exe"
}

function Get-AgentBoxRawProperty {
  param(
    $Object,
    [string]$Name
  )

  if (-not $Object) {
    return ""
  }
  $property = $Object.PSObject.Properties | Where-Object { $_.Name -eq $Name } | Select-Object -First 1
  if (-not $property) {
    return $null
  }
  return $property.Value
}

function Get-AgentBoxProperty {
  param(
    $Object,
    [string]$Name
  )

  $value = Get-AgentBoxRawProperty $Object $Name
  if ($null -eq $value) {
    return ""
  }
  return [string]$value
}

function Get-AgentBoxUninstallEntries {
  $paths = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )

  $entries = @()
  foreach ($path in $paths) {
    try {
      $entries += Get-ItemProperty -Path $path -ErrorAction SilentlyContinue |
        Where-Object { (Get-AgentBoxProperty $_ "DisplayName") -like "AgentBox*" }
    } catch {
    }
  }
  return @($entries)
}

function Get-AgentBoxExecutableCandidates {
  $candidates = New-Object System.Collections.Generic.List[string]
  $entries = Get-AgentBoxUninstallEntries

  foreach ($entry in $entries) {
    $installLocation = Get-AgentBoxProperty $entry "InstallLocation"
    $displayIcon = Get-AgentBoxProperty $entry "DisplayIcon"
    if ($installLocation) {
      $candidates.Add((Join-Path $installLocation "AgentBox.exe"))
    }
    if ($displayIcon) {
      $iconPath = $displayIcon.Trim('"')
      if ($iconPath -match "\.exe") {
        $candidates.Add(($iconPath -replace ",\d+$", ""))
      }
    }
  }

  $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  $knownDirs = @(
    (Join-Path $env:LOCALAPPDATA "Programs\AgentBox\AgentBox.exe"),
    (Join-Path $env:LOCALAPPDATA "AgentBox\AgentBox.exe"),
    (Join-Path $env:ProgramFiles "AgentBox\AgentBox.exe")
  )
  if ($programFilesX86) {
    $knownDirs += (Join-Path $programFilesX86 "AgentBox\AgentBox.exe")
  }

  foreach ($candidate in $knownDirs) {
    $candidates.Add($candidate)
  }

  return @($candidates.ToArray() | Where-Object { $_ } | Select-Object -Unique)
}

function Show-AgentBoxStatus {
  Write-AgentBoxTitle "AgentBox Windows Status"

  Write-AgentBoxSection "Install Info"
  $entries = Get-AgentBoxUninstallEntries
  if ($entries.Count -gt 0) {
    foreach ($entry in $entries) {
      $displayName = Get-AgentBoxProperty $entry "DisplayName"
      $displayVersion = Get-AgentBoxProperty $entry "DisplayVersion"
      $installLocation = Get-AgentBoxProperty $entry "InstallLocation"
      $uninstallString = Get-AgentBoxProperty $entry "UninstallString"
      Write-AgentBoxInfo "Name: $displayName"
      if ($displayVersion) { Write-AgentBoxInfo "Version: $displayVersion" }
      if ($installLocation) { Write-AgentBoxInfo "Install location: $installLocation" }
      if ($uninstallString) { Write-AgentBoxInfo "Uninstall command: $uninstallString" }
    }
  } else {
    Write-AgentBoxInfo "No AgentBox uninstall entry was found in the registry."
  }

  Write-AgentBoxSection "Program Files"
  $foundExe = $false
  foreach ($candidate in Get-AgentBoxExecutableCandidates) {
    if (Test-Path -LiteralPath $candidate) {
      $foundExe = $true
      Write-AgentBoxInfo "Found: $candidate"
    }
  }
  if (-not $foundExe) {
    Write-AgentBoxInfo "AgentBox.exe was not found."
  }

  Write-AgentBoxSection "Running Processes"
  $processes = @(Get-Process -Name "AgentBox", "agentbox-sidecar" -ErrorAction SilentlyContinue)
  if ($processes.Count -gt 0) {
    foreach ($process in $processes) {
      Write-AgentBoxInfo "$($process.ProcessName) PID=$($process.Id)"
    }
  } else {
    Write-AgentBoxInfo "No AgentBox process was found."
  }

  Write-AgentBoxSection "Download Cache"
  Write-AgentBoxInfo "Default download directory: $AgentBoxDownloadDir"
}

function Invoke-AgentBoxUninstall {
  $entries = Get-AgentBoxUninstallEntries
  if ($entries.Count -eq 0) {
    Fail-AgentBox "No AgentBox uninstall entry was found."
  }

  $entry = $entries | Select-Object -First 1
  $command = Get-AgentBoxProperty $entry "UninstallString"
  $quietCommand = Get-AgentBoxProperty $entry "QuietUninstallString"
  if ($AgentBoxSilent -and $quietCommand) {
    $command = $quietCommand
  }
  if (-not $command) {
    Fail-AgentBox "No uninstall command was found in the registry."
  }
  if ($AgentBoxSilent -and $command -notmatch "/S") {
    $command = "$command /S"
  }

  Write-AgentBoxTitle "AgentBox Windows Uninstaller"
  Write-AgentBoxInfo "Uninstall command: $command"
  if ($AgentBoxDryRun) {
    Write-AgentBoxInfo "Dry run: uninstall will not be executed."
    return
  }

  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $command -Wait
  Write-AgentBoxOk "Uninstaller executed"
}

function Install-AgentBoxWindows {
  Write-AgentBoxTitle "AgentBox Windows Installer"

  $arch = Resolve-AgentBoxArch $AgentBoxArch
  $platformKey = Get-AgentBoxPlatformKey $arch
  $manifest = $null
  $version = "latest"
  $downloadUrl = ""

  if ($AgentBoxInstallerPath) {
    $installerPath = $AgentBoxInstallerPath
    if (-not (Test-Path -LiteralPath $installerPath)) {
      Fail-AgentBox "Local installer was not found: $installerPath"
    }
  } else {
    Write-AgentBoxStep "Fetch release manifest"
    Write-AgentBoxInfo $AgentBoxManifestUrl
    $manifest = Read-AgentBoxManifest $AgentBoxManifestUrl
    $manifestVersion = Get-AgentBoxProperty $manifest "version"
    if ($manifestVersion) {
      $version = $manifestVersion
    }
    $platform = Get-AgentBoxPlatform $manifest $platformKey
    $downloadUrl = Get-AgentBoxProperty $platform "url"
    if (-not $downloadUrl) {
      Fail-AgentBox "Release manifest entry $platformKey is missing url."
    }

    $fileName = Get-AgentBoxInstallerFileName $downloadUrl $version $arch
    $installerPath = Join-Path $AgentBoxDownloadDir $fileName
  }

  Write-AgentBoxSection "Install Plan"
  Write-AgentBoxInfo "Target architecture: $arch"
  Write-AgentBoxInfo "Platform key: $platformKey"
  Write-AgentBoxInfo "Latest version: $version"
  if ($downloadUrl) { Write-AgentBoxInfo "Download URL: $downloadUrl" }
  Write-AgentBoxInfo "Installer path: $installerPath"

  $installerArgs = New-Object System.Collections.Generic.List[string]
  if ($AgentBoxSilent) { $installerArgs.Add("/S") }
  if ($AgentBoxCurrentUser) { $installerArgs.Add("/currentuser") }
  if ($AgentBoxAllUsers) { $installerArgs.Add("/allusers") }

  if ($installerArgs.Count -gt 0) {
    Write-AgentBoxInfo "Installer arguments: $($installerArgs.ToArray() -join ' ')"
  } else {
    Write-AgentBoxInfo "Installer arguments: default interactive install"
  }

  if ($AgentBoxNoRun) {
    Write-AgentBoxInfo "Action: download only; do not start installer"
  } elseif ($AgentBoxWait) {
    Write-AgentBoxInfo "Action: start installer and wait for exit"
  } else {
    Write-AgentBoxInfo "Action: start installer and return immediately"
  }

  if ($AgentBoxDryRun) {
    Write-AgentBoxInfo "Dry run: installer will not be downloaded or started."
    return
  }

  if (-not $AgentBoxInstallerPath) {
    New-Item -ItemType Directory -Path $AgentBoxDownloadDir -Force | Out-Null
    if ((Test-Path -LiteralPath $installerPath) -and (-not $AgentBoxForce)) {
      Write-AgentBoxOk "Installer already exists; skipping download: $installerPath"
    } else {
      Write-AgentBoxStep "Download installer"
      Invoke-AgentBoxWebRequest -Uri $downloadUrl -OutFile $installerPath | Out-Null
      Write-AgentBoxOk "Installer downloaded: $installerPath"
    }
  }

  if ($AgentBoxNoRun) {
    Write-AgentBoxOk "Installer prepared; not started"
    return
  }

  Write-AgentBoxStep "Start installer"
  $startParams = @{
    FilePath = $installerPath
  }
  if ($installerArgs.Count -gt 0) {
    $startParams.ArgumentList = $installerArgs.ToArray()
  }
  if ($AgentBoxWait) {
    $startParams.Wait = $true
  }

  Start-Process @startParams
  if ($AgentBoxWait) {
    Write-AgentBoxOk "Installer exited"
  } else {
    Write-AgentBoxOk "Installer started"
  }
}

if ($AgentBoxCat) {
  Show-AgentBoxStatus
  exit 0
}

if ($AgentBoxUninstall) {
  Invoke-AgentBoxUninstall
  exit 0
}

Install-AgentBoxWindows
