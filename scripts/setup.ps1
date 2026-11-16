# tack one-click setup - Windows
# Usage: right-click -> "Run with PowerShell", or:
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
# Re-running is safe: every step checks before acting.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

function Step([string]$msg) { Write-Host ''; Write-Host "== $msg ==" -ForegroundColor Cyan }
function Ok([string]$msg)   { Write-Host "   ok  $msg" -ForegroundColor Green }
function Warn([string]$msg) { Write-Host "   !   $msg" -ForegroundColor Yellow }

try {
    Step '0/6  icons'
    if (-not (Test-Path 'src-tauri\icons\icon.ico')) {
        Warn 'icons not found, generating via make-icons.ps1'
        & (Join-Path $PSScriptRoot 'make-icons.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'icon generation failed' }
        Ok 'icons generated'
    } else {
        Ok 'icons present'
    }

    Step '1/6  Node dependencies'
    if (-not (Test-Path 'node_modules')) {
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
            throw 'npm not found - install Node.js LTS from https://nodejs.org'
        }
        & npm install --no-fund --no-audit
        if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
        Ok 'npm install done'
    } else {
        Ok 'node_modules present'
    }

    Step '2/6  Rust toolchain'
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw 'cargo not found - install Rust stable from https://rustup.rs, then reopen this window'
    }
    Ok ((& cargo -V) | Out-String).Trim()

    Step '3/6  Python virtual environment'
    $py = 'python'
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        if (Get-Command py -ErrorAction SilentlyContinue) { $py = 'py' } else { throw 'Python not found - install 3.11+ from https://python.org' }
    }
    $venv = Join-Path $root 'core\.venv'
    if (-not (Test-Path $venv)) {
        & $py -m venv $venv
        if ($LASTEXITCODE -ne 0) { throw 'failed to create venv' }
        Ok 'venv created'
    } else {
        Ok 'venv present'
    }
    $pip = Join-Path $venv 'Scripts\pip.exe'
    & $pip install --quiet --upgrade pip
    & $pip install --quiet -r (Join-Path $root 'core\requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }
    Ok 'python dependencies installed'

    Step '4/6  smoke test (offline, no API key needed)'
    $pyExe = Join-Path $venv 'Scripts\python.exe'
    Push-Location (Join-Path $root 'core')
    & $pyExe -m unittest discover -s tests -q
    $testCode = $LASTEXITCODE
    Pop-Location
    if ($testCode -ne 0) { throw 'core tests failed - see output above' }
    Ok 'core tests passed'

    Step '5/6  first build (this takes a few minutes the first time)'
    Warn 'skipped by default - run scripts\dev.ps1 to try: it builds and launches'
    Ok 'setup complete'

    Step '6/6  next'
    Write-Host '   Run:  powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1'
    Write-Host '   Or view UI only:  open ui\preview.html in a browser'
} catch {
    Write-Host ''
    Write-Host "SETUP FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
