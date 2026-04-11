$ErrorActionPreference = "Stop"
$api = "http://localhost:4000/api"
$results = @()

function Log($step, $msg) { Write-Host "[$step] $msg" }

# 1. Health
$h = Invoke-RestMethod "$api/health"
Log "1-HEALTH" $h.status

# 2. Register
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$email = "smoke${ts}@test.com"
$body = @{ email = $email; password = "Smoke12345!"; name = "Smoke" } | ConvertTo-Json
$reg = Invoke-RestMethod -Uri "$api/auth/register" -Method POST -Body $body -ContentType "application/json"
Log "2-REGISTER" $reg.user.email
$tok = $reg.token

# 3. Login
$lb = @{ email = $email; password = "Smoke12345!" } | ConvertTo-Json
$lg = Invoke-RestMethod -Uri "$api/auth/login" -Method POST -Body $lb -ContentType "application/json"
Log "3-LOGIN" "token=$($lg.token.Substring(0,20))..."

# 4. /me
$me = Invoke-RestMethod -Uri "$api/auth/me" -Headers @{ Authorization = "Bearer $tok" }
Log "4-ME" "$($me.email) role=$($me.role)"

# 5. List audits (empty)
$la = Invoke-RestMethod -Uri "$api/audits" -Headers @{ Authorization = "Bearer $tok" }
Log "5-LIST-EMPTY" "total=$($la.total)"

# 6. Upload contract
$sampleDpa = Join-Path $PSScriptRoot "sample-dpa.txt"
$form = [System.Net.Http.MultipartFormDataContent]::new()
$fs = [System.IO.File]::OpenRead($sampleDpa)
$fc = [System.Net.Http.StreamContent]::new($fs)
$form.Add($fc, "contract", "sample-dpa.txt")
$client = [System.Net.Http.HttpClient]::new()
$client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $tok)
$resp = $client.PostAsync("$api/audits", $form).Result
$auditJson = $resp.Content.ReadAsStringAsync().Result
$audit = $auditJson | ConvertFrom-Json
$fs.Close(); $client.Dispose()
Log "6-UPLOAD" "status=$($audit.status) clauses=$($audit.clausesDetected) gaps=$($audit.gapsFound) risk=$($audit.overallRisk)($($audit.riskScore))"
$auditId = $audit.id

# 7. Get single audit with report
$detail = Invoke-RestMethod -Uri "$api/audits/$auditId" -Headers @{ Authorization = "Bearer $tok" }
$clauseKeys = ($detail.report.clauses | Get-Member -MemberType NoteProperty).Name -join ","
$remCount = if ($detail.report.remediation_plan) { $detail.report.remediation_plan.Count } else { 0 }
Log "7-DETAIL" "clauses=[$clauseKeys] remediation=$remCount"

# 8. List audits (should have 1)
$la2 = Invoke-RestMethod -Uri "$api/audits" -Headers @{ Authorization = "Bearer $tok" }
Log "8-LIST-FULL" "total=$($la2.total) first=$($la2.audits[0].contractName)"

# 9. Delete
Invoke-WebRequest -Uri "$api/audits/$auditId" -Method DELETE -Headers @{ Authorization = "Bearer $tok" } | Out-Null
$la3 = Invoke-RestMethod -Uri "$api/audits" -Headers @{ Authorization = "Bearer $tok" }
Log "9-DELETE" "total=$($la3.total)"

# 10. Dashboard
$dash = Invoke-WebRequest http://localhost:3000
Log "10-DASHBOARD" "status=$($dash.StatusCode) length=$($dash.Content.Length)"

Write-Host ""
Write-Host "ALL 10 CHECKS PASSED" -ForegroundColor Green
