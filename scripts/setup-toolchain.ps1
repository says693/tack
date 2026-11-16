# tack toolchain installer - Windows 10/11
#
#   Check only:              powershell -ExecutionPolicy Bypass -File .\scripts\setup-toolchain.ps1
#   Install what is missing: powershell -ExecutionPolicy Bypass -File .\scripts\setup-toolchain.ps1 -InstallMissing
#   Also need root privileges? add: -Elevate
#
# Installs user-scope where possible (Git, Node, Python, Rust).
# MSVC Build Tools is the one item that may trigger a UAC prompt.
# Uses winget, which ships with Windows 11 and recent Windows 10.

param(
    [switch]$InstallMissing,
    [switch]$Elevate
)

$ErrorActionPreference = 'Stop'
$report = @()

function Have([string]$name, [string]$probe, [string]$minVer, [string]$arg = '-V') {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $cmd) { return $null }
    $raw = (& $name $arg 2>&1 | Out-String).Trim()
    return [pscustomobject]@{ Path = $cmd.Source; Version = $raw }
}

function Winget-Install([string]$id, [string]$label, [string[]]$extra) {
    Write-Host "   installing $label ($id) ..." -ForegroundColor Cyan
    $args = @('install', '--id', $id, '-e', '--silent',
              '--accept-package-agreements', '--accept-source-agreements') + $extra
    & winget @args
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   ! winget failed for $label (code $LASTEXITCODE). Install it manually." -ForegroundColor Yellow
        return $false
    }
    Write-Host "   ok  $label" -ForegroundColor Green
    return $true
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host 'winget not found. On Windows 10 install "App Installer" from the Microsoft Store, then re-run.' -ForegroundColor Red
    if ($InstallMissing) { exit 1 }
}

Write-Host ''
Write-Host '=== toolchain check ===' -ForegroundColor Cyan
Write-Host ''

$checks = @(
    @{ Key = 'git';    Label = 'Git';             Probe = (Have 'git' 'x' '' '--version');
       WingetId = 'Git.Git';                Extra = @('--scope','user') },
    @{ Key = 'node';   Label = 'Node.js LTS';     Probe = (Have 'node' 'x' '' '-v');
       WingetId = 'OpenJS.NodeJS.LTS';      Extra = @('--scope','user') },
    @{ Key = 'python'; Label = 'Python 3.12';     Probe = (Have 'python' 'x' '' '-V');
       WingetId = 'Python.Python.3.12';     Extra = @('--scope','user') },
    @{ Key = 'cargo';  Label = 'Rust (rustup)';   Probe = (Have 'cargo' 'x' '' '-V');
       WingetId = 'Rustlang.Rustup';        Extra = @() },
    @{ Key = 'msvc';   Label = 'MSVC Build Tools'; Probe = $null;
       WingetId = 'Microsoft.VisualStudio.2022.BuildTools';
       Extra = @('--override','--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended') }
)

# MSVC detection via vswhere
$pf86 = ${env:ProgramFiles(x86)}
if ($pf86) {
    $vswhere = Join-Path $pf86 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path $vswhere) {
        $vs = (& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null)
        if ($vs) { $checks[4].Probe = [pscustomobject]@{ Path = $vs; Version = 'VC Tools present' } }
    }
}

foreach ($c in $checks) {
    if ($c.Probe) {
        Write-Host ("   ok   {0,-18} {1}" -f $c.Label, $c.Probe.Version) -ForegroundColor Green
    } else {
        Write-Host ("   --   {0,-18} missing" -f $c.Label) -ForegroundColor Yellow
        $report += $c
    }
}

if ($report.Count -eq 0) {
    Write-Host ''
    Write-Host 'All present. Next: scripts\setup.ps1 then scripts\dev.ps1' -ForegroundColor Green
    exit 0
}

if (-not $InstallMissing) {
    Write-Host ''
    Write-Host "$($report.Count) item(s) missing. Re-run with -InstallMissing to install them:" -ForegroundColor Yellow
    Write-Host '   powershell -ExecutionPolicy Bypass -File .\scripts\setup-toolchain.ps1 -InstallMissing'
    exit 0
}

Write-Host ''
Write-Host '=== installing ===' -ForegroundColor Cyan
foreach ($c in $report) {
    if ($c.Key -eq 'msvc' -and -not $Elevate) {
        Write-Host '   note  MSVC Build Tools usually needs elevation; if it fails, open an admin PowerShell and run:' -ForegroundColor DarkGray
        Write-Host "         winget install --id $($c.WingetId) -e --accept-package-agreements $($c.Extra -join ' ')" -ForegroundColor DarkGray
    }
    Winget-Install $c.WingetId $c.Label $c.Extra | Out-Null
}

# Refresh PATH for this session from the machine + user registry
$machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$user = [Environment]::GetEnvironmentVariable('Path', 'User')
$env:Path = "$machine;$user"

Write-Host ''
Write-Host '=== re-check (open a NEW terminal if a tool still looks missing) ===' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot '..\check-env.ps1')
