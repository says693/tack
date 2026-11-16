# tack environment check - Windows (v2)
# Finds toolchains even when they are NOT on PATH (portable/unzipped copies).
# Usage: right-click -> "Run with PowerShell", or:
#   powershell -ExecutionPolicy Bypass -File .\check-env.ps1
# Copy everything from "=== tack environment report ===" down.

$ErrorActionPreference = 'SilentlyContinue'
$rows = New-Object System.Collections.ArrayList
$found = @{}   # name -> resolved path (may be portable)

function Add-Row([string]$item, [string]$status, [string]$detail) {
    [void]$rows.Add([pscustomobject]@{ Item = $item; Status = $status; Detail = $detail })
}

function Find-Exe([string]$name, [string[]]$globs) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($g in $globs) {
        $hit = Get-ChildItem -Path $g -Filter $name -Recurse -Depth 4 -File -ErrorAction SilentlyContinue |
               Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

# Common homes for portable installs
$roots = @(
    'C:\tools', 'C:\dev', 'C:\Program Files', 'C:\Program Files (x86)',
    "$env:LOCALAPPDATA\Programs", "$env:USERPROFILE\scoop\apps",
    "$env:USERPROFILE\scoop\shims", "$env:USERPROFILE\.cargo\bin",
    "$env:USERPROFILE\AppData\Roaming\npm", 'D:\tools', 'D:\dev', 'D:\Program Files',
    'E:\tools', 'E:\dev', 'H:\tools', 'H:\dev', 'H:\软件', 'D:\软件', 'E:\软件'
) | Where-Object { Test-Path $_ }

# --- Node.js (need 20+) ---
$node = Find-Exe 'node.exe' @($roots)
if ($node) {
    $v = (& $node -v 2>$null)
    if ($v) {
        $ver = $v.TrimStart('v')
        $ok = $false; try { $ok = ([version]($ver -replace '-.*','')) -ge [version]'20.0.0' } catch {}
        if ($ok) { Add-Row 'Node.js' 'OK' "$v  $node"; $found.node = $node }
        else { Add-Row 'Node.js' 'UPGRADE' "$v at $node - need 20+" }
    }
} else { Add-Row 'Node.js' 'MISSING' 'https://nodejs.org (LTS)' }

if ($found.node) {
    $npm = Join-Path (Split-Path $found.node) 'npm.cmd'
    if (Test-Path $npm) { Add-Row 'npm' 'OK' ((& $npm -v) + '  ' + $npm) }
    else {
        $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
        if ($npmCmd) { Add-Row 'npm' 'OK' $npmCmd.Source }
        else { Add-Row 'npm' 'WARN' 'missing next to node.exe - reinstall Node' }
    }
}

# --- Rust ---
$cargo = Find-Exe 'cargo.exe' @($roots)
if (-not $cargo) { $cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe' }
if (Test-Path $cargo) { Add-Row 'Rust (cargo)' 'OK' ((& $cargo -V) + '  ' + $cargo); $found.cargo = $cargo }
else { Add-Row 'Rust (cargo)' 'MISSING' 'https://rustup.rs - install stable, MSVC host' }

$rustc = Find-Exe 'rustc.exe' @($roots)
if (-not $rustc) { $rustc = Join-Path $env:USERPROFILE '.cargo\bin\rustc.exe' }
if (Test-Path $rustc) { Add-Row 'Rust (rustc)' 'OK' (& $rustc -V) }

# --- Python (need 3.11+) ---
$py = Find-Exe 'python.exe' @($roots)
if (-not $py) {
    $launcher = Get-Command py -ErrorAction SilentlyContinue
    if ($launcher) { $py = $launcher.Source }
}
if ($py) {
    $pv = (& $py -V 2>&1 | Out-String).Trim()
    if ($pv -match 'Python\s+(\d+\.\d+\.\d+)') {
        $ver = $Matches[1]
        $ok = $false; try { $ok = ([version]$ver) -ge [version]'3.11.0' } catch {}
        if ($ok) { Add-Row 'Python' 'OK' "$pv  $py"; $found.py = $py }
        else { Add-Row 'Python' 'UPGRADE' "$pv at $py - need 3.11+" }
    }
} else { Add-Row 'Python' 'MISSING' 'https://python.org (3.12)' }

# --- MSVC Build Tools: Tauri needs the MSVC linker (link.exe) ---
$vswhere = $null
$pf86 = ${env:ProgramFiles(x86)}
if ($pf86) { $vswhere = Join-Path $pf86 'Microsoft Visual Studio\Installer\vswhere.exe' }
if ($vswhere -and (Test-Path $vswhere)) {
    $vs = (& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null)
    if ($vs) { Add-Row 'MSVC Build Tools' 'OK' $vs }
    else { Add-Row 'MSVC Build Tools' 'MISSING' 'VS Installer -> "Desktop development with C++" (or Build Tools 2022)' }
} else {
    Add-Row 'MSVC Build Tools' 'MISSING' 'https://aka.ms/vs/17/release/vs_BuildTools.exe (C++ workload)'
}

# --- WebView2 (Tauri runtime) ---
$wv = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}').pv
if (-not $wv) { $wv = (Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}').pv }
if ($wv) { Add-Row 'WebView2 Runtime' 'OK' "version $wv" }
else { Add-Row 'WebView2 Runtime' 'MISSING' 'Evergreen Runtime from Microsoft (Win11 usually has it)' }

# --- Git ---
$git = Find-Exe 'git.exe' @($roots)
if ($git) { Add-Row 'Git' 'OK' ((& $git --version) + '  ' + $git) }
else { Add-Row 'Git' 'MISSING' 'https://git-scm.com' }

# --- Disk ---
$h = Get-PSDrive H -ErrorAction SilentlyContinue
if ($h) {
    $free = [math]::Round($h.Free / 1GB, 1)
    Add-Row 'H: free space' $(if ($free -ge 5) { 'OK' } else { 'LOW' }) "$free GB"
}

Write-Host ''
Write-Host '=== tack environment report ===' -ForegroundColor Cyan
Write-Host ''
Write-Host ($rows | Format-Table -AutoSize | Out-String -Width 220)
$bad = @($rows | Where-Object { $_.Status -in @('MISSING','UPGRADE','WARN','LOW') })
if ($bad.Count -eq 0) { Write-Host 'RESULT: all green.' -ForegroundColor Green }
else {
    Write-Host "RESULT: $($bad.Count) item(s) need attention." -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'Want me to auto-install the missing ones? Run:' -ForegroundColor DarkGray
    Write-Host '   powershell -ExecutionPolicy Bypass -File .\scripts\setup-toolchain.ps1 -InstallMissing' -ForegroundColor DarkGray
}
Write-Host ''
Write-Host 'Copy everything from "=== tack environment report ===" down and paste it here.'
