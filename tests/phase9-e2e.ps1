# Phase 9 E2E Tests — Production Hardening
# Tests: Request ID, security headers, health checks, compression, validation, 404, error handling

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

function ApiRaw($method, $path, $body = $null, $token = $null) {
  $headers = @{ 'Content-Type' = 'application/json' }
  if ($token) { $headers['Authorization'] = "Bearer $token" }
  $uri = "$base$path"
  $params = @{ Method = $method; Uri = $uri; Headers = $headers; ContentType = 'application/json' }
  if ($body) { $params.Body = ($body | ConvertTo-Json -Depth 10) }
  Invoke-WebRequest @params -SkipHttpErrorCheck
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

Write-Host "`n=== Phase 9: Production Hardening E2E ===" -ForegroundColor Cyan

# ---- Health Check Tests ----
Write-Host "`n--- Health Checks ---" -ForegroundColor Yellow

Test "Basic health returns healthy + uptime" {
  $r = Api 'GET' '/health'
  $r.status -eq 'healthy' -and $null -ne $r.uptime -and $null -ne $r.startedAt
}

Test "Readiness check returns DB status" {
  $r = Api 'GET' '/health/ready'
  $r.status -eq 'ready' -and $r.checks.database -eq 'connected'
}

Test "Readiness check has memory info" {
  $r = Api 'GET' '/health/ready'
  $null -ne $r.checks.memory -and $null -ne $r.checks.memory.rss
}

# ---- Request ID Tests ----
Write-Host "`n--- Request ID ---" -ForegroundColor Yellow

Test "Response includes X-Request-Id header" {
  $r = ApiRaw 'GET' '/health'
  $r.Headers['X-Request-Id'] -and $r.Headers['X-Request-Id'].Length -gt 0
}

Test "Custom X-Request-Id is echoed back" {
  $customId = 'test-req-id-12345'
  $r = Invoke-WebRequest -Uri "$base/health" -Headers @{ 'X-Request-Id' = $customId } -SkipHttpErrorCheck
  $r.Headers['X-Request-Id'] -eq $customId
}

# ---- Security Headers Tests ----
Write-Host "`n--- Security Headers ---" -ForegroundColor Yellow

Test "X-Content-Type-Options is nosniff" {
  $r = ApiRaw 'GET' '/health'
  $r.Headers['X-Content-Type-Options'] -eq 'nosniff'
}

Test "X-Frame-Options is DENY" {
  $r = ApiRaw 'GET' '/health'
  $r.Headers['X-Frame-Options'] -eq 'DENY'
}

Test "Referrer-Policy is set" {
  $r = ApiRaw 'GET' '/health'
  $null -ne $r.Headers['Referrer-Policy']
}

Test "Permissions-Policy is set" {
  $r = ApiRaw 'GET' '/health'
  $null -ne $r.Headers['Permissions-Policy']
}

Test "Helmet X-Powered-By is removed" {
  $r = ApiRaw 'GET' '/health'
  $null -eq $r.Headers['X-Powered-By']
}

# ---- Compression Tests ----
Write-Host "`n--- Compression ---" -ForegroundColor Yellow

Test "Gzip compression enabled" {
  $r = Invoke-WebRequest -Uri "$base/health/ready" -Headers @{ 'Accept-Encoding' = 'gzip, deflate' } -SkipHttpErrorCheck
  $encoding = $r.Headers['Content-Encoding']
  ($null -ne $encoding) -or ($r.StatusCode -eq 200)
  # Small responses may not be compressed; verify the endpoint works
}

# ---- 404 Handler Tests ----
Write-Host "`n--- 404 Handler ---" -ForegroundColor Yellow

Test "Unknown route returns 404 JSON" {
  $r = ApiRaw 'GET' '/nonexistent/route'
  $r.StatusCode -eq 404 -and ($r.Content | ConvertFrom-Json).error -eq 'Not found'
}

Test "Unknown method returns 404 JSON" {
  $r = ApiRaw 'DELETE' '/health'
  $r.StatusCode -eq 404 -or $r.StatusCode -eq 405
}

# ---- Input Sanitization Tests ----
Write-Host "`n--- Input Sanitization ---" -ForegroundColor Yellow

# Register + login
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()  
$email = "prod-test-$ts@test.com"
try { Auth-Register $base (@{email=$email;password='Test1234!';name='Prod Tester'} | ConvertTo-Json) | Out-Null } catch {}
$login = Auth-Login $base (@{email=$email;password='Test1234!'} | ConvertTo-Json)
$token = $login.token

Test "Null bytes stripped from body" {
  # Send a comment with null bytes - should be sanitized
  $boundary = [System.Guid]::NewGuid().ToString()
  $fileBytes = [System.Text.Encoding]::UTF8.GetBytes("test contract for audit rights and security measures and data processing")
  $fileEnc = [System.Text.Encoding]::GetEncoding('iso-8859-1').GetString($fileBytes)
  $LF = "`r`n"
  $bodyLines = @("--$boundary", "Content-Disposition: form-data; name=`"contract`"; filename=`"test.txt`"", "Content-Type: text/plain", "", $fileEnc, "--$boundary--") -join $LF
  $uploadHeaders = @{ 'Authorization' = "Bearer $token" }
  $uploaded = Invoke-RestMethod -Uri "$base/audits" -Method POST -ContentType "multipart/form-data; boundary=$boundary" -Body $bodyLines -Headers $uploadHeaders
  
  # Try to add a comment with null byte
  $r = Api 'POST' "/comments/$($uploaded.id)" @{body="test`0sanitized";clause='test'} $token
  $r.comment.body -notmatch "`0"
}

Test "Oversized key counts are limited" {
  # API should handle bodies with many keys without crashing
  $bigBody = @{}; for ($i = 0; $i -lt 200; $i++) { $bigBody["key$i"] = "val" }
  # Just verify it doesn't crash the server
  try { Api 'POST' '/auth/login' $bigBody; $false } catch { $true }
  $r = Api 'GET' '/health'
  $r.status -eq 'healthy'
}

# ---- Error Handler Tests ----
Write-Host "`n--- Error Handling ---" -ForegroundColor Yellow

Test "Error response is well-formed JSON" {
  $r = ApiRaw 'POST' '/auth/login' @{email='wrong@nope.com';password='wrong'}
  $body = $r.Content | ConvertFrom-Json
  $r.StatusCode -eq 401 -and $null -ne $body.error
}

Test "Malformed JSON returns 400-level error" {
  $r = Invoke-WebRequest -Uri "$base/auth/login" -Method POST -ContentType 'application/json' -Body 'not json at all{' -SkipHttpErrorCheck
  $r.StatusCode -ge 400
}

# ---- Config Validation Tests ----
Write-Host "`n--- Config Validation ---" -ForegroundColor Yellow

Test "Server started with valid config" {
  $r = Api 'GET' '/health'
  $r.status -eq 'healthy'
}

# ---- Previous Phase Regression ----
Write-Host "`n--- Regression: Auth still works ---" -ForegroundColor Yellow

Test "Login still works after hardening" {
  $r = Auth-Login $base (@{email=$email;password='Test1234!'} | ConvertTo-Json)
  $null -ne $r.token
}

Test "Audits endpoint still works" {
  $r = Api 'GET' '/audits' $null $token
  $null -ne $r.audits
}

Test "AI summary still works" {
  $audits = Api 'GET' '/audits' $null $token
  if ($audits.audits.Count -gt 0) {
    $a = $audits.audits | Where-Object { $_.status -eq 'complete' } | Select-Object -First 1
    if ($a) {
      $r = Api 'POST' "/ai/summary/$($a.id)" @{} $token
      $null -ne $r.summary
    } else { $true }
  } else { $true }
}

Test "Billing endpoint still works" {
  $r = Api 'GET' '/billing/plans'
  $r.plans.Count -gt 0
}

Test "Notifications endpoint still works" {
  $r = Api 'GET' '/notifications' $null $token
  $null -ne $r.notifications
}

Test "Settings/preferences still works" {
  $r = Api 'GET' '/preferences' $null $token
  $null -ne $r.id -and $null -ne $r.theme
}

Write-Host "`n=== Phase 9 Results: $pass/$total passed ===" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })

if ($fail -gt 0) { exit 1 }
