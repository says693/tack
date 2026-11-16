# tack - init git + first commit + push to GitHub
#   powershell -ExecutionPolicy Bypass -File .\scripts\publish.ps1 -Repo tack
# Requires: git installed, and GitHub access (browser login or a PAT when prompted).
# Safe to re-run: it skips steps already done.

param(
    [string]$Repo = 'tack',
    [string]$User = '',            # your GitHub username; leaves blank to be asked
    [switch]$Public = $true
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

function Step([string]$m) { Write-Host ''; Write-Host "== $m ==" -ForegroundColor Cyan }
function Ok([string]$m)   { Write-Host "   ok  $m" -ForegroundColor Green }

try {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw 'git not found - install from https://git-scm.com'
    }

    Step '1/4  local repository'
    if (-not (Test-Path '.git')) {
        git init -b main | Out-Null
        Ok 'git initialized (branch main)'
    } else {
        Ok 'git repository already exists'
    }

    if (-not (git config user.name)) {
        $n = Read-Host 'Your git name (press Enter for "tack contributor")'
        if (-not $n) { $n = 'tack contributor' }
        git config user.name $n
    }
    if (-not (git config user.email)) {
        $e = Read-Host 'Your git email (press Enter for "you@example.com")'
        if (-not $e) { $e = 'you@example.com' }
        git config user.email $e
    }

    Step '2/4  first commit'
    # never let a stray key or local db sneak in
    if (git status --porcelain | Select-String -Pattern '(tack\.local\.json|\.env|^.. data/)') {
        Write-Host '   ! found local config/data in changes - they are gitignored, continuing' -ForegroundColor Yellow
    }
    git add .
    if (git status --porcelain) {
        git commit -m "G0: 三窗骨架、Python 内核、安装器与右键快捷键" | Out-Null
        Ok "committed $((git status --porcelain | Measure-Object).Count) changes"
    } else {
        Ok 'nothing new to commit'
    }

    Step '3/4  remote'
    if ($User -eq '') { $User = Read-Host 'Your GitHub username' }
    if (-not $User) { throw 'username required' }
    $remote = "https://github.com/$User/$Repo.git"

    $existing = git remote get-url origin 2>$null
    if ($existing) {
        Ok "remote origin already set: $existing"
    } else {
        git remote add origin $remote
        Ok "remote origin -> $remote"
    }

    Step '4/4  push'
    Write-Host '   A browser window may open for GitHub sign-in.' -ForegroundColor DarkGray
    Write-Host '   If it asks for a password, use a Personal Access Token (Settings -> Developer settings -> Tokens).' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host '   If the repo does not exist yet, create it first at:' -ForegroundColor DarkGray
    Write-Host "      https://github.com/new  (name: $Repo, do not add README/.gitignore/LICENSE)" -ForegroundColor DarkGray
    Write-Host ''
    Read-Host 'Press Enter when the empty repo exists on GitHub'

    git push -u origin main
    if ($LASTEXITCODE -ne 0) { throw 'push failed - see the error above' }

    Ok "published -> https://github.com/$User/$Repo"
    Write-Host ''
    Write-Host 'Next: release an installer with tags' -ForegroundColor Cyan
    Write-Host '   git tag v0.1.0; git push origin v0.1.0'
    Write-Host '   GitHub Actions then attaches Windows/macOS/Linux installers to a draft Release.'
} catch {
    Write-Host "PUBLISH FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
