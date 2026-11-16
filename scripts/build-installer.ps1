# tack - build installers for the current OS
#   powershell -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1
# Windows output: src-tauri\target\release\bundle\nsis\tack_0.1.0_x64-setup.exe
# macOS output:   src-tauri\target\release\bundle\dmg\*.dmg
# Linux output:   src-tauri\target\release\bundle\appimage\*.AppImage

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

function Step([string]$m) { Write-Host ''; Write-Host "== $m ==" -ForegroundColor Cyan }

try {
    Step 'icons'
    if (-not (Test-Path 'src-tauri\icons\icon.ico')) {
        & (Join-Path $PSScriptRoot 'make-icons.ps1')
    }

    Step 'dependencies'
    if (-not (Test-Path 'node_modules')) { & npm install --no-fund --no-audit }

    Step 'build (release, several minutes)'
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'build failed' }

    Step 'output'
    $bundle = Join-Path $root 'src-tauri\target\release\bundle'
    Get-ChildItem -Recurse $bundle -Include *.exe, *.msi, *.dmg, *.AppImage 2>$null |
        Select-Object FullName, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } |
        Format-Table -AutoSize | Out-String | Write-Host
    Write-Host 'Installer ready. Upload the file above to your GitHub Release.' -ForegroundColor Green
} catch {
    Write-Host "BUILD FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
