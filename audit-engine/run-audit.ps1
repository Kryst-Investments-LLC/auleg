param([string]$ContractPath)

# Use script's own location to find the platform root
$AuditEngineRoot = $PSScriptRoot
$Root = Split-Path $AuditEngineRoot -Parent
$Output = Join-Path $Root "audit-output"
if (!(Test-Path $Output)) { New-Item -ItemType Directory -Path $Output | Out-Null }

# 1. Load contract text
Write-Host "Extracting contract text..." -ForegroundColor Cyan
$pdfExtractor = Join-Path $AuditEngineRoot "pdf-extractor.ps1"
$raw = pwsh -File $pdfExtractor -Path $ContractPath

# 2. Clause Detection
Write-Host "Detecting clauses..." -ForegroundColor Cyan

$patternsPath = Join-Path $AuditEngineRoot "data/clause-detection.json.hbs"
$patternsJson = Get-Content $patternsPath -Raw | ConvertFrom-Json

$clauses = @{}

# Split into paragraphs
$paragraphs = $raw -split "(\r?\n){2,}"

foreach ($para in $paragraphs) {
    $text = $para.Trim()
    if ($text.Length -lt $patternsJson.heuristics.min_clause_length) { continue }

    foreach ($key in $patternsJson.patterns.PSObject.Properties.Name) {
        $regexList = $patternsJson.patterns.$key
        $keywords  = $patternsJson.keywords.$key

        $regexHit = $false
        foreach ($regex in $regexList) {
            if ($text -match $regex) {
                $regexHit = $true
                break
            }
        }

        $keywordHits = 0
        foreach ($kw in $keywords) {
            if ($text -match [regex]::Escape($kw)) {
                $keywordHits++
            }
        }

        $keywordScore = if ($keywords.Count -gt 0) { $keywordHits / $keywords.Count } else { 0 }
        $confidence   = if ($regexHit) { 0.7 + ($keywordScore * 0.3) } else { $keywordScore }

        if ($confidence -ge $patternsJson.heuristics.confidence_threshold) {
            if (-not $clauses.ContainsKey($key)) {
                $clauses[$key] = $text
            }
        }
    }
}

# 3. Regulation Mapping
Write-Host "Mapping to regulations..." -ForegroundColor Cyan

$mappingPath = Join-Path $AuditEngineRoot "data/regulation-mapping.json.hbs"
$mappingJson = Get-Content $mappingPath -Raw | ConvertFrom-Json

$matrix = @{}

foreach ($clause in $clauses.Keys) {
    $matrix[$clause] = $mappingJson.mapping.$clause
}

# 4. Gap Analysis
Write-Host "Running gap analysis..." -ForegroundColor Cyan

$required = @(
    "data_processing_purpose",
    "subprocessor_controls",
    "breach_notification",
    "data_subject_rights",
    "security_measures",
    "audit_rights"
)

$gaps = @()

foreach ($req in $required) {
    if (-not $clauses.ContainsKey($req)) {
        $gaps += $req
    }
}

# 5. Risk Scoring
Write-Host "Computing risk..." -ForegroundColor Cyan

# Framework weights
$frameworkWeights = @{
    "GDPR"      = 5
    "CCPA"      = 3
    "ISO 27701" = 2
    "SOC 2"     = 2
}

# Helper: compute regulatory exposure for a clause
function Get-RegulatoryExposure {
    param([string[]]$FrameworkRefs)

    $total = 0
    foreach ($ref in $FrameworkRefs) {
        foreach ($fw in $frameworkWeights.Keys) {
            if ($ref -like "$fw*") {
                $total += $frameworkWeights[$fw]
            }
        }
    }

    if ($total -le 0) { return 1 }
    $normalized = [math]::Min(5, [math]::Round($total / 3))
    return $normalized
}

# Simple severity/likelihood heuristics based on clause type
function Get-SeverityLikelihood {
    param([string]$ClauseKey)

    switch ($ClauseKey) {
        "breach_notification"   { return 5,4 }
        "subprocessor_controls" { return 4,3 }
        "data_subject_rights"   { return 4,3 }
        "security_measures"     { return 5,3 }
        "audit_rights"          { return 3,2 }
        default                 { return 3,2 }
    }
}

$clauseScores = @()
$totalScore   = 0

foreach ($clauseKey in $clauses.Keys) {
    $frameworkRefs = @()
    if ($matrix.ContainsKey($clauseKey)) {
        $frameworkRefs = $matrix[$clauseKey]
    }

    $regExposure = Get-RegulatoryExposure -FrameworkRefs $frameworkRefs
    $sev, $lik   = Get-SeverityLikelihood -ClauseKey $clauseKey

    $baseScore   = ($sev * 0.6) + ($lik * 0.4)
    $clauseScore = ($sev * 0.5) + ($lik * 0.3) + ($regExposure * 0.2)
    $final       = [math]::Round($clauseScore * 20)

    $totalScore += $final

    $clauseScores += @{
        clause              = $clauseKey
        severity            = $sev
        likelihood          = $lik
        regulatory_exposure = $regExposure
        score               = $final
    }
}

if ($clauseScores.Count -gt 0) {
    $overall = [math]::Round($totalScore / $clauseScores.Count)
} else {
    $overall = 0
}

$riskLevel = if ($overall -le 20) { "Low" }
             elseif ($overall -le 50) { "Moderate" }
             elseif ($overall -le 75) { "High" }
             else { "Critical" }

$risk = @{
    overall_risk = $riskLevel
    score        = $overall
    clause_scores = $clauseScores
    missing_clauses = $gaps
}

# 6. Remediation
Write-Host "Generating remediation..." -ForegroundColor Cyan

$remediationPath = Join-Path $AuditEngineRoot "data/remediation-language.json.hbs"
$remediationJson = Get-Content $remediationPath -Raw | ConvertFrom-Json

$remediation = @()

# Remediation for missing clauses (gaps)
foreach ($gap in $gaps) {
    $template = $remediationJson.templates.$gap
    if ($template) {
        $remediation += @{
            clause             = $gap
            action             = "missing"
            title              = $template.title
            severity           = $template.severity
            suggested_language = $template.suggested_language
            references         = $template.references
        }
    } else {
        $remediation += @{
            clause   = $gap
            action   = "missing"
            title    = "Add clause: $gap"
            severity = "Moderate"
            suggested_language = "No template available. Consult legal counsel."
            references = @()
        }
    }
}

# Remediation for high-risk detected clauses (score >= 70)
foreach ($cs in $clauseScores) {
    if ($cs.score -ge 70) {
        $template = $remediationJson.templates.($cs.clause)
        if ($template) {
            $remediation += @{
                clause             = $cs.clause
                action             = "strengthen"
                title              = "Strengthen: $($template.title)"
                severity           = $template.severity
                risk_score         = $cs.score
                suggested_language = $template.suggested_language
                references         = $template.references
            }
        }
    }
}

# 7. Generate Report
$report = @{
    contract = $ContractPath
    clauses = $clauses
    compliance_matrix = $matrix
    gap_report = $gaps
    risk_profile = $risk
    remediation_plan = $remediation
    generated = (Get-Date).ToString("o")
}

$reportPath = Join-Path $Output "audit_report.json"
$report | ConvertTo-Json -Depth 20 | Set-Content -Path $reportPath

Write-Host "Audit complete." -ForegroundColor Green
Write-Host "Report: $reportPath"
