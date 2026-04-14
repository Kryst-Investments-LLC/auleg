# Phase 8 E2E Tests — AI Enhancements
# Tests: AI Summary, AI Clause Analysis, AI Remediation, AI Explain, NL Search

$ErrorActionPreference = 'Continue'
$base = 'http://localhost:4000/api'
$pass = 0; $fail = 0; $total = 0

function Test($name, $script) {
  $script:total++
  try {
    $result = & $script
    if ($result) { $script:pass++; Write-Host "  PASS: $name" -ForegroundColor Green }
    else { $script:fail++; Write-Host "  FAIL: $name (returned false)" -ForegroundColor Red }
  } catch {
    $script:fail++; Write-Host "  FAIL: $name - $_" -ForegroundColor Red
  }
}

function Api($method, $path, $body = $null, $token = $null) {
  $headers = @{ 'Content-Type' = 'application/json' }
  if ($token) { $headers['Authorization'] = "Bearer $token" }
  $uri = "$base$path"
  $params = @{ Method = $method; Uri = $uri; Headers = $headers; ContentType = 'application/json' }
  if ($body) { $params.Body = ($body | ConvertTo-Json -Depth 10) }
  Invoke-RestMethod @params
}

. "$PSScriptRoot\test-helpers.ps1"

Write-Host "`n=== Phase 8: AI Enhancements E2E ===" -ForegroundColor Cyan

# Setup: Register + Login
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$email = "ai-test-$ts@test.com"
try { Auth-Register $base (@{email=$email;password='Test1234!';name='AI Tester'} | ConvertTo-Json) } catch {}
$login = Auth-Login $base (@{email=$email;password='Test1234!'} | ConvertTo-Json)
$token = $login.token

Write-Host "`nUser registered & logged in: $email" -ForegroundColor Gray

# Upload a contract to get a completed audit
$contractPath = "$PSScriptRoot\..\test-contracts\sample-dpa.txt"
if (-Not (Test-Path $contractPath)) {
  # Create a test contract
  $contractDir = "$PSScriptRoot\..\test-contracts"
  if (-Not (Test-Path $contractDir)) { New-Item -ItemType Directory -Path $contractDir -Force | Out-Null }
  @"
DATA PROCESSING AGREEMENT

This Data Processing Agreement ("DPA") is entered into between the parties.

1. PURPOSE AND SCOPE
The processor shall process personal data only on documented instructions from the controller, including transfers to third countries.

2. SECURITY MEASURES
The processor shall implement appropriate technical and organizational measures to ensure a level of security appropriate to the risk, including encryption of personal data and regular testing of security measures.

3. BREACH NOTIFICATION
The processor shall notify the controller without undue delay after becoming aware of a personal data breach, within 72 hours maximum.

4. SUB-PROCESSORS
The processor shall not engage another processor without prior specific written authorization of the controller. The processor shall maintain a list of approved sub-processors.

5. DATA SUBJECT RIGHTS
The processor shall assist the controller by appropriate technical and organisational measures for the fulfilment of the controller's obligation to respond to requests for exercising the data subject's rights.

6. AUDIT RIGHTS
The controller shall have the right to conduct audits, including inspections, of the processor's data processing activities.

7. DATA RETENTION
Personal data shall be retained only for the duration necessary to fulfill the processing purpose. Upon termination, data shall be deleted or returned within 30 days.

8. TERMINATION
Either party may terminate this agreement with 30 days written notice. Upon termination, the processor shall cease all processing and return or delete personal data.
"@ | Set-Content -Path $contractPath -Encoding UTF8
}

# Upload contract using multipart form
$boundary = [System.Guid]::NewGuid().ToString()
$LF = "`r`n"
$filePath = (Resolve-Path $contractPath).Path
$fileBytes = [System.IO.File]::ReadAllBytes($filePath)
$fileEnc = [System.Text.Encoding]::GetEncoding('iso-8859-1').GetString($fileBytes)
$bodyLines = @(
  "--$boundary",
  "Content-Disposition: form-data; name=`"contract`"; filename=`"sample-dpa.txt`"",
  "Content-Type: text/plain",
  "",
  $fileEnc,
  "--$boundary--"
) -join $LF

$uploadHeaders = @{
  'Authorization' = "Bearer $token"
}
$uploadResult = Invoke-RestMethod -Uri "$base/audits" -Method POST -ContentType "multipart/form-data; boundary=$boundary" -Body $bodyLines -Headers $uploadHeaders
$auditId = $uploadResult.id

Write-Host "Uploaded audit ID: $auditId, status: $($uploadResult.status)" -ForegroundColor Gray

# Wait for audit to complete (polling)
$maxWait = 30
$waited = 0
while ($waited -lt $maxWait) {
  Start-Sleep -Seconds 2
  $waited += 2
  $check = Api 'GET' "/audits/$auditId" $null $token
  if ($check.status -eq 'complete') {
    Write-Host "Audit completed after ${waited}s" -ForegroundColor Gray
    break
  }
}
$audit = Api 'GET' "/audits/$auditId" $null $token

# ---- AI Summary Tests ----
Write-Host "`n--- AI Summary ---" -ForegroundColor Yellow

Test "AI Summary returns markdown" {
  $r = Api 'POST' "/ai/summary/$auditId" @{} $token
  $r.summary -match 'Executive Summary' -and $r.auditId -eq $auditId
}

Test "AI Summary contains risk level" {
  $r = Api 'POST' "/ai/summary/$auditId" @{} $token
  $r.summary -match 'Risk Level'
}

Test "AI Summary 404 for nonexistent audit" {
  try { Api 'POST' '/ai/summary/00000000-0000-0000-0000-000000000000' @{} $token; $false } catch { $_ -match '404|not found|Not Found' }
}

# ---- AI Clause Analysis Tests ----
Write-Host "`n--- AI Clause Analysis ---" -ForegroundColor Yellow

Test "AI Analyze returns all clauses" {
  $r = Api 'POST' "/ai/analyze/$auditId" @{} $token
  $r.analyses.Count -gt 0
}

Test "AI Analyze single clause" {
  $r = Api 'POST' "/ai/analyze/$auditId" @{clause='breach_notification'} $token
  $r.analysis -and $r.analysis.clause -eq 'breach_notification'
}

Test "AI Analyze clause has gdprArticle" {
  $r = Api 'POST' "/ai/analyze/$auditId" @{clause='breach_notification'} $token
  $r.analysis.gdprArticle -match 'Article'
}

Test "AI Analyze clause has riskLevel" {
  $r = Api 'POST' "/ai/analyze/$auditId" @{clause='breach_notification'} $token
  $r.analysis.riskLevel -in @('critical','high','medium','low')
}

Test "AI Analyze unknown clause returns 404" {
  try { Api 'POST' "/ai/analyze/$auditId" @{clause='nonexistent_clause'} $token; $false } catch { $_ -match '404|not found|Not Found' }
}

# ---- AI Remediation Tests ----
Write-Host "`n--- AI Remediation ---" -ForegroundColor Yellow

Test "AI Remediation returns plan" {
  $r = Api 'POST' "/ai/remediate/$auditId" @{} $token
  $r.plan -and $r.plan.totalItems -ge 0
}

Test "AI Remediation has priority counts" {
  $r = Api 'POST' "/ai/remediate/$auditId" @{} $token
  $null -ne $r.plan.criticalCount -and $null -ne $r.plan.highCount -and $null -ne $r.plan.mediumCount
}

Test "AI Remediation items have suggestedLanguage" {
  $r = Api 'POST' "/ai/remediate/$auditId" @{} $token
  if ($r.plan.items.Count -gt 0) { $r.plan.items[0].suggestedLanguage.Length -gt 0 } else { $true }
}

# ---- AI Explain Tests ----
Write-Host "`n--- AI Risk Explanation ---" -ForegroundColor Yellow

Test "AI Explain returns explanation" {
  $r = Api 'POST' "/ai/explain/$auditId" @{} $token
  $r.explanation -and $r.explanation.explanation.Length -gt 0
}

Test "AI Explain has recommendation" {
  $r = Api 'POST' "/ai/explain/$auditId" @{} $token
  $r.explanation.recommendation.Length -gt 0
}

Test "AI Explain has risk factors" {
  $r = Api 'POST' "/ai/explain/$auditId" @{} $token
  $null -ne $r.explanation.factors
}

# ---- AI NL Search Tests ----
Write-Host "`n--- AI Natural Language Search ---" -ForegroundColor Yellow

Test "NL Search basic query" {
  $r = Api 'POST' '/ai/search' @{query='show me all audits'} $token
  $null -ne $r.results -and $null -ne $r.interpretation
}

Test "NL Search risk filter" {
  $r = Api 'POST' '/ai/search' @{query='critical risk audits'} $token
  $r.filters.risk -eq 'Critical' -and $r.interpretation -match 'critical'
}

Test "NL Search status filter" {
  $r = Api 'POST' '/ai/search' @{query='completed audits'} $token
  $r.filters.status -eq 'complete'
}

Test "NL Search clause focus" {
  $r = Api 'POST' '/ai/search' @{query='audits with breach notification issues'} $token
  $r.filters.clauseFocus -eq 'breach_notification'
}

Test "NL Search time filter" {
  $r = Api 'POST' '/ai/search' @{query='audits from this week'} $token
  $null -ne $r.filters.from
}

Test "NL Search sort by risk" {
  $r = Api 'POST' '/ai/search' @{query='show worst audits'} $token
  $r.filters.sort -eq 'riskScore' -and $r.filters.order -eq 'desc'
}

Test "NL Search empty query returns 400" {
  try { Api 'POST' '/ai/search' @{query=''} $token; $false } catch { $_ -match '400|Query' }
}

# ---- Auth guard ----
Write-Host "`n--- Auth Guards ---" -ForegroundColor Yellow

Test "AI endpoints require auth" {
  try {
    $headers = @{ 'Content-Type' = 'application/json' }
    Invoke-RestMethod -Uri "$base/ai/summary/$auditId" -Method POST -Headers $headers -ContentType 'application/json' -Body '{}'
    $false
  } catch {
    $true  # Any error means auth blocked it
  }
}

Write-Host "`n=== Phase 8 Results: $pass/$total passed ===" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })

if ($fail -gt 0) { exit 1 }
