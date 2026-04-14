param(
  [string[]]$Suites = @(
  'e2e-smoke.ps1',
  'e2e-phase2.ps1',
  'tests/phase5-e2e.ps1',
  'tests/phase6-e2e.ps1',
  'tests/phase7-e2e.ps1',
  'tests/phase8-e2e.ps1',
  'tests/phase9-e2e.ps1',
  'tests/phase10-e2e.ps1'
  )
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Invoke-Suite($relativePath) {
  $suitePath = Join-Path $repoRoot $relativePath
  if (-not (Test-Path $suitePath)) {
    throw "Suite not found: $relativePath"
  }

  Write-Host "`n=== Running $relativePath ===" -ForegroundColor Cyan
  $output = @()
  & pwsh -NoLogo -NoProfile -File $suitePath *>&1 | Tee-Object -Variable output | Out-Host
  $exitCode = $LASTEXITCODE

  if ($exitCode -ne 0) {
    throw "Suite exited with code ${exitCode}: $relativePath"
  }

  $failedLines = @(
    $output | Where-Object {
      $line = "$_"
      $line -match '^\s*FAIL(?::|\s)'
    }
  )

  if ($failedLines.Count -gt 0) {
    throw "Suite reported failures: $relativePath"
  }
}

foreach ($suite in $Suites) {
  Invoke-Suite $suite
}

Write-Host "`nAll CI suites passed." -ForegroundColor Green