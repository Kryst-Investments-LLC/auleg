# Phase 10 E2E Tests — Public API & Integrations
# Tests: Versioned API, scope enforcement, integrations, webhook deliveries

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

function ApiRaw($method, $path, $body = $null, $token = $null) {
  $headers = @{ 'Content-Type' = 'application/json' }
  if ($token) { $headers['Authorization'] = "Bearer $token" }
  $uri = "$base$path"
  $params = @{ Method = $method; Uri = $uri; Headers = $headers; ContentType = 'application/json' }
  if ($body) { $params.Body = ($body | ConvertTo-Json -Depth 10) }
  Invoke-WebRequest @params -SkipHttpErrorCheck
}

Write-Host "`n=== Phase 10: Public API & Integrations E2E ===" -ForegroundColor Cyan

# ---- Setup: Register + create API key ----
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$email = "api-test-$ts@test.com"
try { Api 'POST' '/auth/register' @{email=$email;password='Test1234!';name='API Tester'} | Out-Null } catch {}
$login = Api 'POST' '/auth/login' @{email=$email;password='Test1234!'}
$jwt = $login.token

Write-Host "User: $email" -ForegroundColor Gray

# Create an API key with all scopes
$apiKeyResult = Api 'POST' '/api-keys' @{name='test-key';scopes=@('audits:read','audits:write','webhooks:read','webhooks:write','templates:read','templates:write')} $jwt
$fullApiKey = $apiKeyResult.key

# Create a read-only API key (only audits:read)
$readOnlyKeyResult = Api 'POST' '/api-keys' @{name='read-only-key';scopes=@('audits:read')} $jwt
$readOnlyKey = $readOnlyKeyResult.key

Write-Host "API keys created: full=$($apiKeyResult.prefix)... readonly=$($readOnlyKeyResult.prefix)..." -ForegroundColor Gray

# Upload a contract for testing
$contractPath = "$PSScriptRoot\..\test-contracts\sample-dpa.txt"
$boundary = [System.Guid]::NewGuid().ToString()
$LF = "`r`n"
$fileBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $contractPath).Path)
$fileEnc = [System.Text.Encoding]::GetEncoding('iso-8859-1').GetString($fileBytes)
$bodyLines = @("--$boundary", "Content-Disposition: form-data; name=`"contract`"; filename=`"sample-dpa.txt`"", "Content-Type: text/plain", "", $fileEnc, "--$boundary--") -join $LF
$uploaded = Invoke-RestMethod -Uri "$base/audits" -Method POST -ContentType "multipart/form-data; boundary=$boundary" -Body $bodyLines -Headers @{ 'Authorization' = "Bearer $jwt" }
$auditId = $uploaded.id
Write-Host "Uploaded audit: $auditId" -ForegroundColor Gray

# Wait for completion
$maxWait = 30; $waited = 0
while ($waited -lt $maxWait) {
  Start-Sleep -Seconds 2; $waited += 2
  $check = Api 'GET' "/audits/$auditId" $null $jwt
  if ($check.status -eq 'complete') { Write-Host "Audit complete (${waited}s)" -ForegroundColor Gray; break }
}

# ---- Public API v1: JWT Auth ----
Write-Host "`n--- v1 API with JWT ---" -ForegroundColor Yellow

Test "v1 list audits with JWT" {
  $r = Api 'GET' '/v1/audits' $null $jwt
  $r.data.Count -ge 1 -and $null -ne $r.pagination
}

Test "v1 list audits has pagination" {
  $r = Api 'GET' '/v1/audits?limit=2&offset=0' $null $jwt
  $null -ne $r.pagination.total -and $r.pagination.limit -eq 2
}

Test "v1 get audit detail" {
  $r = Api 'GET' "/v1/audits/$auditId" $null $jwt
  $r.data.id -eq $auditId -and $null -ne $r.data.report
}

Test "v1 get audit report download" {
  $r = ApiRaw 'GET' "/v1/audits/$auditId/report?format=json" $null $jwt
  $r.StatusCode -eq 200 -and $r.Headers['Content-Disposition'] -match 'attachment'
}

Test "v1 get audit report as CSV" {
  $r = ApiRaw 'GET' "/v1/audits/$auditId/report?format=csv" $null $jwt
  $r.StatusCode -eq 200 -and $r.Content -match 'clause,score,status'
}

# ---- Public API v1: API Key Auth ----
Write-Host "`n--- v1 API with API Key ---" -ForegroundColor Yellow

Test "v1 list audits with API key" {
  $r = Api 'GET' '/v1/audits' $null $fullApiKey
  $r.data.Count -ge 1
}

Test "v1 get audit with API key" {
  $r = Api 'GET' "/v1/audits/$auditId" $null $fullApiKey
  $r.data.id -eq $auditId
}

# ---- Scope Enforcement ----
Write-Host "`n--- Scope Enforcement ---" -ForegroundColor Yellow

Test "Read-only key can list audits" {
  $r = Api 'GET' '/v1/audits' $null $readOnlyKey
  $r.data.Count -ge 0
}

Test "Read-only key blocked from webhooks" {
  $r = ApiRaw 'GET' '/v1/webhooks' $null $readOnlyKey
  $r.StatusCode -eq 403
}

Test "Read-only key blocked from templates" {
  $r = ApiRaw 'GET' '/v1/templates' $null $readOnlyKey
  $r.StatusCode -eq 403
}

# ---- AI via Public API ----
Write-Host "`n--- AI via v1 API ---" -ForegroundColor Yellow

Test "v1 AI summary with JWT" {
  $r = Api 'POST' "/v1/audits/$auditId/ai/summary" @{} $jwt
  $null -ne $r.data.summary
}

Test "v1 AI analyze with API key" {
  $r = Api 'POST' "/v1/audits/$auditId/ai/analyze" @{} $fullApiKey
  $r.data.Count -ge 1
}

Test "v1 AI summary 404 for unknown" {
  $r = ApiRaw 'POST' '/v1/audits/00000000-0000-0000-0000-000000000000/ai/summary' $null $jwt
  $r.StatusCode -eq 404
}

# ---- Webhooks ----
Write-Host "`n--- Webhooks ---" -ForegroundColor Yellow

Test "v1 list webhooks" {
  $r = Api 'GET' '/v1/webhooks' $null $jwt
  $null -ne $r.data
}

# Create a webhook for delivery testing
$wh = Api 'POST' '/webhooks' @{url='https://example.com/webhook';events='audit.complete';secret='test-secret'} $jwt

Test "v1 webhook deliveries list" {
  $r = Api 'GET' "/v1/webhooks/$($wh.id)/deliveries" $null $jwt
  $null -ne $r.data -and $null -ne $r.pagination
}

# ---- Templates ----
Write-Host "`n--- Templates ---" -ForegroundColor Yellow

# Create a template
$tmpl = Api 'POST' '/templates' @{name='GDPR Basic';clauseTypes=@('audit_rights','breach_notification');frameworks=@('GDPR')} $jwt

Test "v1 list templates with API key" {
  $r = Api 'GET' '/v1/templates' $null $fullApiKey
  $r.data.Count -ge 1
}

Test "v1 templates have parsed arrays" {
  $r = Api 'GET' '/v1/templates' $null $fullApiKey
  $t = $r.data[0]
  $t.clauseTypes.Count -ge 1 -and $t.frameworks.Count -ge 1
}

# ---- Integrations ----
Write-Host "`n--- Integrations ---" -ForegroundColor Yellow

Test "Zapier trigger returns recent audits" {
  $r = Api 'POST' '/v1/integrations/zapier' @{since=(Get-Date).AddDays(-7).ToString('o')} $jwt
  $r.Count -ge 0
}

Test "Slack payload returns blocks" {
  $r = Api 'POST' "/v1/integrations/slack" @{auditId=$auditId} $jwt
  $r.data.blocks.Count -ge 1
}

Test "Slack payload has risk info" {
  $r = Api 'POST' "/v1/integrations/slack" @{auditId=$auditId} $jwt
  $fields = $r.data.blocks[1].fields
  ($fields | Where-Object { $_.text -match 'Risk' }).Count -ge 1
}

Test "CSV bulk export" {
  $r = ApiRaw 'POST' "/v1/integrations/csv-export" @{status='complete'} $jwt
  $r.StatusCode -eq 200 -and $r.Content -match 'contractName'
}

Test "Slack payload 404 for unknown audit" {
  $r = ApiRaw 'POST' '/v1/integrations/slack' @{auditId='00000000-0000-0000-0000-000000000000'} $jwt
  $r.StatusCode -eq 404
}

# ---- Auth Required ----
Write-Host "`n--- Auth Guards ---" -ForegroundColor Yellow

Test "v1 requires auth" {
  $r = ApiRaw 'GET' '/v1/audits'
  $r.StatusCode -eq 401
}

# ---- Regression ----
Write-Host "`n--- Regression ---" -ForegroundColor Yellow

Test "Original /audits still works" {
  $r = Api 'GET' '/audits' $null $jwt
  $null -ne $r.audits
}

Test "Health check still works" {
  $r = Api 'GET' '/health'
  $r.status -eq 'healthy'
}

Test "AI search still works" {
  $r = Api 'POST' '/ai/search' @{query='show all audits'} $jwt
  $null -ne $r.results
}

Write-Host "`n=== Phase 10 Results: $pass/$total passed ===" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })

if ($fail -gt 0) { exit 1 }
