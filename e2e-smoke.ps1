$ErrorActionPreference = 'Stop'

$suitePath = Join-Path $PSScriptRoot 'tests\phase11-e2e.ps1'
& $suitePath

if ($LASTEXITCODE -ne 0) {
	exit $LASTEXITCODE
}
