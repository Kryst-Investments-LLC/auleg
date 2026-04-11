#!/usr/bin/env pwsh
# Phase 6 E2E Tests: Comments, Tags, Version Diff, Compliance Report, User Preferences
$ErrorActionPreference = 'Continue'
$base = 'http://localhost:4000/api'
$pass = 0; $fail = 0

function Test($name, $ok) {
  if ($ok) { Write-Host "  PASS  $name" -ForegroundColor Green; $script:pass++ }
  else     { Write-Host "  FAIL  $name" -ForegroundColor Red;   $script:fail++ }
}

Write-Host "`n=== Phase 6 E2E Tests ===" -ForegroundColor Cyan

# ---------- Auth ----------
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$body = @{ email="p6user$ts@test.com"; password="Pass1234!"; name="P6 User" } | ConvertTo-Json
$reg = Invoke-RestMethod "$base/auth/register" -Method Post -Body $body -ContentType 'application/json'
$tok = $reg.token
$headers = @{ Authorization = "Bearer $tok" }
Write-Host "Logged in as p6user$ts@test.com" -ForegroundColor DarkGray

# ---------- Create an audit ----------
$boundary = "----TestBoundary$(Get-Random)"
$contract = "This agreement establishes data processing purposes and audit rights between Controller and Processor. Breach notification within 72 hours required."
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes(
  "--$boundary`r`nContent-Disposition: form-data; name=`"contract`"; filename=`"p6test.txt`"`r`nContent-Type: text/plain`r`n`r`n$contract`r`n--$boundary--`r`n"
)
$upload = Invoke-RestMethod "$base/audits" -Method Post -Headers $headers `
  -ContentType "multipart/form-data; boundary=$boundary" -Body $bodyBytes
$auditId = $upload.id
Write-Host "Created audit $auditId" -ForegroundColor DarkGray

# Wait for processing
Start-Sleep -Seconds 6

# ---------- 1. Add comment ----------
try {
  $cmBody = @{ body="This clause needs review."; clause="audit_rights" } | ConvertTo-Json
  $cm = Invoke-RestMethod "$base/comments/$auditId" -Method Post -Headers $headers -Body $cmBody -ContentType 'application/json'
  Test "Add comment" ($cm.body -eq "This clause needs review." -and $cm.clause -eq "audit_rights")
  $commentId = $cm.id
} catch {
  Test "Add comment" $false; $commentId = $null
}

# ---------- 2. List comments ----------
try {
  $cmList = Invoke-RestMethod "$base/comments/$auditId" -Method Get -Headers $headers
  Test "List comments" ($cmList.comments.Count -ge 1)
} catch {
  Test "List comments" $false
}

# ---------- 3. Edit comment ----------
try {
  $editBody = @{ body="Updated: needs legal review." } | ConvertTo-Json
  $edited = Invoke-RestMethod "$base/comments/$auditId/$commentId" -Method Put -Headers $headers -Body $editBody -ContentType 'application/json'
  Test "Edit comment" ($edited.body -eq "Updated: needs legal review.")
} catch {
  Test "Edit comment" $false
}

# ---------- 4. Delete comment ----------
try {
  $del = Invoke-WebRequest "$base/comments/$auditId/$commentId" -Method Delete -Headers $headers
  Test "Delete comment" ($del.StatusCode -eq 204)
} catch {
  Test "Delete comment" $false
}

# ---------- 5. Set tags ----------
try {
  $tagBody = @{ tags=@("gdpr","high-priority","review") } | ConvertTo-Json
  $tagged = Invoke-RestMethod "$base/audits/$auditId/tags" -Method Patch -Headers $headers -Body $tagBody -ContentType 'application/json'
  Test "Set tags" ($tagged.tags.Count -eq 3 -and $tagged.tags -contains "gdpr")
} catch {
  Test "Set tags" $false
}

# ---------- 6. Update tags (remove one) ----------
try {
  $tagBody2 = @{ tags=@("gdpr","review") } | ConvertTo-Json
  $tagged2 = Invoke-RestMethod "$base/audits/$auditId/tags" -Method Patch -Headers $headers -Body $tagBody2 -ContentType 'application/json'
  Test "Update tags" ($tagged2.tags.Count -eq 2)
} catch {
  Test "Update tags" $false
}

# ---------- 7. Create re-audit for diff ----------
try {
  $ra = Invoke-RestMethod "$base/audits/$auditId/re-audit" -Method Post -Headers $headers -ContentType 'application/json'
  $v2Id = $ra.id
  Start-Sleep -Seconds 6
  Test "Re-audit for diff" ($ra.version -eq 2)
} catch {
  Test "Re-audit for diff" $false; $v2Id = $null
}

# ---------- 8. Version diff ----------
try {
  $diff = Invoke-RestMethod "$base/audits/$auditId/diff/$v2Id" -Method Get -Headers $headers
  Test "Version diff" ($diff.meta.left.id -eq $auditId -and $diff.meta.right.id -eq $v2Id -and $null -ne $diff.riskScore)
} catch {
  Test "Version diff" $false
}

# ---------- 9. Diff has clause details ----------
try {
  Test "Diff clause details" ($diff.clauses -is [array])
} catch {
  Test "Diff clause details" $false
}

# ---------- 10. Compliance report ----------
try {
  $comp = Invoke-RestMethod "$base/audits/$auditId/compliance" -Method Get -Headers $headers
  Test "Compliance report" ($comp.summary.totalClauses -ge 0 -and $null -ne $comp.summary.complianceRate -and $null -ne $comp.audit.id)
} catch {
  Test "Compliance report" $false
}

# ---------- 11. Compliance has clause breakdown ----------
try {
  Test "Compliance clause breakdown" ($comp.clauseBreakdown -is [array])
} catch {
  Test "Compliance clause breakdown" $false
}

# ---------- 12. Get preferences (auto-creates) ----------
try {
  $prefs = Invoke-RestMethod "$base/preferences" -Method Get -Headers $headers
  Test "Get preferences" ($prefs.emailDigest -eq "none" -and $prefs.theme -eq "dark" -and $prefs.notifyAuditComplete -eq $true)
} catch {
  Test "Get preferences" $false
}

# ---------- 13. Update preferences ----------
try {
  $prefBody = @{ emailDigest="weekly"; theme="light"; notifyShare=$false } | ConvertTo-Json
  $updPrefs = Invoke-RestMethod "$base/preferences" -Method Patch -Headers $headers -Body $prefBody -ContentType 'application/json'
  Test "Update preferences" ($updPrefs.emailDigest -eq "weekly" -and $updPrefs.theme -eq "light" -and $updPrefs.notifyShare -eq $false)
} catch {
  Test "Update preferences" $false
}

# ---------- 14. Invalid preference rejected ----------
try {
  $badPref = @{ emailDigest="hourly" } | ConvertTo-Json
  Invoke-RestMethod "$base/preferences" -Method Patch -Headers $headers -Body $badPref -ContentType 'application/json' -ErrorAction Stop
  Test "Invalid preference rejected" $false
} catch {
  Test "Invalid preference rejected" $true
}

# ---------- 15. Dashboard HTML loads ----------
try {
  $html = Invoke-WebRequest "http://localhost:3000" -UseBasicParsing
  Test "Dashboard HTML loads" ($html.StatusCode -eq 200 -and $html.Content.Contains('root'))
} catch {
  Test "Dashboard HTML loads" $false
}

Write-Host "`n=== Results: $pass passed, $fail failed out of $($pass+$fail) ===" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
