$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    foreach ($tool in @('node', 'npm', 'cargo', 'uv')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            throw "Missing $tool. See docs/TOOLCHAIN.md."
        }
    }
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    uv sync --project core --frozen --group build
    if ($LASTEXITCODE -ne 0) { throw 'uv sync failed' }
    Push-Location core
    try {
        uv run --frozen python -m unittest discover -s tests -v
        if ($LASTEXITCODE -ne 0) { throw 'Core tests failed' }
    } finally { Pop-Location }
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'UI tests failed' }
    Write-Host 'Ready. Run npm run dev, or scripts/build-installer.ps1.'
} finally { Pop-Location }
