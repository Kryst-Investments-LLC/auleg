#!/usr/bin/env pwsh
# Phase 5 E2E Tests: Versioning, Scheduling, Sharing, Scoring Rules
$ErrorActionPreference = 'Continue'
$base = 'http://localhost:4000/api'
$pass = 0; $fail = 0

function Test($name, $ok) {
  if ($ok) { Write-Host "  PASS  $name" -ForegroundColor Green; $script:pass++ }
  else     { Write-Host "  FAIL  $name" -ForegroundColor Red;   $script:fail++ }
}

. "$PSScriptRoot\test-helpers.ps1"
Write-Host "`n=== Phase 5 E2E Tests ===" -ForegroundColor Cyan

# ---------- Auth ----------
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$body = @{ email="p5user$ts@test.com"; password="Pass1234!"; name="P5 User" } | ConvertTo-Json
$reg = Auth-Register $base $body
$tok = $reg.token
$headers = @{ Authorization = "Bearer $tok" }
Write-Host "Logged in as p5user$ts@test.com" -ForegroundColor DarkGray

# ---------- Create an audit to work with ----------
$boundary = "----TestBoundary$(Get-Random)"
$contract = "This agreement establishes data processing purposes and audit rights between Controller and Processor."
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes(
  "--$boundary`r`nContent-Disposition: form-data; name=`"contract`"; filename=`"p5test.txt`"`r`nContent-Type: text/plain`r`n`r`n$contract`r`n--$boundary--`r`n"
)
$upload = Invoke-RestMethod "$base/audits" -Method Post -Headers $headers `
  -ContentType "multipart/form-data; boundary=$boundary" -Body $bodyBytes
$auditId = $upload.id
Write-Host "Created audit $auditId" -ForegroundColor DarkGray

# Wait for processing
Start-Sleep -Seconds 6

# ---------- 1. Re-Audit (versioning) ----------
try {
  $reaudit = Invoke-RestMethod "$base/audits/$auditId/re-audit" -Method Post -Headers $headers -ContentType 'application/json'
  Test "Re-audit creates new version" ($reaudit.version -eq 2 -and $reaudit.parentId -eq $auditId)
  $v2Id = $reaudit.id
} catch {
  Test "Re-audit creates new version" $false
  $v2Id = $null
}

# ---------- 2. Get versions ----------
try {
  $versions = Invoke-RestMethod "$base/audits/$auditId/versions" -Method Get -Headers $headers
  Test "Get version history" ($versions.versions.Count -ge 2)
} catch {
  Test "Get version history" $false
}

# ---------- 3. Share audit ----------
try {
  $shareBody = @{ auditId=$auditId; email="shared$ts@test.com"; permission="view" } | ConvertTo-Json
  $share = Invoke-RestMethod "$base/shares" -Method Post -Headers $headers -Body $shareBody -ContentType 'application/json'
  Test "Share audit" ($share.token.Length -gt 0 -and $share.sharedWith -eq "shared$ts@test.com")
  $shareToken = $share.token
  $shareId = $share.id
} catch {
  Test "Share audit" $false
  $shareToken = $null; $shareId = $null
}

# ---------- 4. Get shared audit by token (public) ----------
try {
  $pub = Invoke-RestMethod "$base/shares/token/$shareToken" -Method Get
  Test "Public share token access" ($pub.contractName -eq "p5test.txt" -and $pub.permission -eq "view")
} catch {
  Test "Public share token access" $false
}

# ---------- 5. List shares for audit ----------
try {
  $slist = Invoke-RestMethod "$base/shares/audit/$auditId" -Method Get -Headers $headers
  Test "List audit shares" ($slist.shares.Count -ge 1)
} catch {
  Test "List audit shares" $false
}

# ---------- 6. Revoke share ----------
try {
  $rev = Invoke-WebRequest "$base/shares/$shareId" -Method Delete -Headers $headers
  Test "Revoke share" ($rev.StatusCode -eq 204)
} catch {
  Test "Revoke share" $false
}

# ---------- 7. Create scoring rule ----------
try {
  $ruleBody = @{ name="Flag Missing Audit Rights"; clause="audit_rights"; condition="missing"; weight=2.0; action="flag" } | ConvertTo-Json
  $rule = Invoke-RestMethod "$base/scoring-rules" -Method Post -Headers $headers -Body $ruleBody -ContentType 'application/json'
  Test "Create scoring rule" ($rule.clause -eq "audit_rights" -and $rule.weight -eq 2.0)
  $ruleId = $rule.id
} catch {
  Test "Create scoring rule" $false; $ruleId = $null
}

# ---------- 8. List scoring rules ----------
try {
  $rlist = Invoke-RestMethod "$base/scoring-rules" -Method Get -Headers $headers
  Test "List scoring rules" ($rlist.rules.Count -ge 1)
} catch {
  Test "List scoring rules" $false
}

# ---------- 9. Update scoring rule ----------
try {
  $upBody = @{ weight=3.5; action="reduce" } | ConvertTo-Json
  $upRule = Invoke-RestMethod "$base/scoring-rules/$ruleId" -Method Put -Headers $headers -Body $upBody -ContentType 'application/json'
  Test "Update scoring rule" ($upRule.weight -eq 3.5 -and $upRule.action -eq "reduce")
} catch {
  Test "Update scoring rule" $false
}

# ---------- 10. Delete scoring rule ----------
try {
  $dr = Invoke-WebRequest "$base/scoring-rules/$ruleId" -Method Delete -Headers $headers
  Test "Delete scoring rule" ($dr.StatusCode -eq 204)
} catch {
  Test "Delete scoring rule" $false
}

# ---------- 11. Create schedule ----------
try {
  $schedBody = @{ name="Weekly Review"; auditId=$auditId; cron="0 9 * * 1" } | ConvertTo-Json
  $sched = Invoke-RestMethod "$base/schedules" -Method Post -Headers $headers -Body $schedBody -ContentType 'application/json'
  Test "Create schedule" ($sched.name -eq "Weekly Review" -and $sched.cron -eq "0 9 * * 1")
  $schedId = $sched.id
} catch {
  Test "Create schedule" $false; $schedId = $null
}

# ---------- 12. List schedules ----------
try {
  $schList = Invoke-RestMethod "$base/schedules" -Method Get -Headers $headers
  Test "List schedules" ($schList.schedules.Count -ge 1)
} catch {
  Test "List schedules" $false
}

# ---------- 13. Toggle schedule off ----------
try {
  $togBody = @{ active=$false } | ConvertTo-Json
  $togSch = Invoke-RestMethod "$base/schedules/$schedId" -Method Patch -Headers $headers -Body $togBody -ContentType 'application/json'
  Test "Toggle schedule off" ($togSch.active -eq $false)
} catch {
  Test "Toggle schedule off" $false
}

# ---------- 14. Delete schedule ----------
try {
  $dsch = Invoke-WebRequest "$base/schedules/$schedId" -Method Delete -Headers $headers
  Test "Delete schedule" ($dsch.StatusCode -eq 204)
} catch {
  Test "Delete schedule" $false
}

# ---------- 15. Dashboard HTML loads ----------
try {
  $html = Invoke-WebRequest "http://localhost:3000" -UseBasicParsing -TimeoutSec 2
  Test "Dashboard HTML loads" ($html.StatusCode -eq 200 -and $html.Content.Contains('root'))
} catch {
  Write-Host "  SKIP  Dashboard HTML loads (port 3000 not running)" -ForegroundColor Yellow
}

Write-Host "`n=== Results: $pass passed, $fail failed out of $($pass+$fail) ===" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
