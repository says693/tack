# tack dev launcher - Windows
# First run compiles Rust and can take 3-8 minutes. Later runs are seconds.
#   powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

Write-Host ''
Write-Host 'tack dev - the HUD capsule appears at the bottom-right of your screen.' -ForegroundColor Cyan
Write-Host 'Click it to open the main window. Close the console to quit.' -ForegroundColor DarkGray

try {
    & npm run dev
} finally {
    Pop-Location
}
