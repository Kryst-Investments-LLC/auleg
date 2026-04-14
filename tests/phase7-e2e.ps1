#!/usr/bin/env pwsh
# Phase 7 E2E Tests: Multi-tenant Billing, Plan Enforcement, Usage Metering
$ErrorActionPreference = 'Continue'
$base = 'http://localhost:4000/api'
$pass = 0; $fail = 0

function Test($name, $ok) {
  if ($ok) { Write-Host "  PASS  $name" -ForegroundColor Green; $script:pass++ }
  else     { Write-Host "  FAIL  $name" -ForegroundColor Red;   $script:fail++ }
}

. "$PSScriptRoot\test-helpers.ps1"
Write-Host "`n=== Phase 7 E2E Tests ===" -ForegroundColor Cyan

# ---------- Auth ----------
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$body = @{ email="p7user$ts@test.com"; password="Pass1234!"; name="P7 User" } | ConvertTo-Json
$reg = Auth-Register $base $body
$tok = $reg.token
$headers = @{ Authorization = "Bearer $tok" }
Write-Host "Logged in as p7user$ts@test.com" -ForegroundColor DarkGray

# ---------- 1. List plans (no auth required) ----------
try {
  $plans = Invoke-RestMethod "$base/billing/plans" -Method Get
  Test "List plans" ($plans.plans.Count -eq 5)
} catch {
  Test "List plans" $false
}

# ---------- 2. Plan details correct ----------
try {
  $free = $plans.plans | Where-Object { $_.id -eq 'free' }
  $starter = $plans.plans | Where-Object { $_.id -eq 'starter' }
  $pro = $plans.plans | Where-Object { $_.id -eq 'pro' }
  $business = $plans.plans | Where-Object { $_.id -eq 'business' }
  $ent = $plans.plans | Where-Object { $_.id -eq 'enterprise' }
  Test "Plan details" ($free.price -eq 0 -and $starter.price -eq 2900 -and $pro.price -eq 9900 -and $business.price -eq 24900 -and $ent.price -eq 99900)
} catch {
  Test "Plan details" $false
}

# ---------- 3. Get billing account (solo user = virtual) ----------
try {
  $billing = Invoke-RestMethod "$base/billing/account" -Method Get -Headers $headers
  Test "Billing account (solo)" ($billing.virtual -eq $true -and $billing.plan -eq 'free')
} catch {
  Test "Billing account (solo)" $false
}

# ---------- 4. Get usage (solo user) ----------
try {
  $usage = Invoke-RestMethod "$base/billing/usage" -Method Get -Headers $headers
  Test "Usage stats (solo)" ($null -ne $usage.audits -and $null -ne $usage.users -and $null -ne $usage.storage)
} catch {
  Test "Usage stats (solo)" $false
}

# ---------- Create org for billing tests ----------
$orgBody = @{ name="P7 Billing Corp" } | ConvertTo-Json
$org = Invoke-RestMethod "$base/orgs" -Method Post -Headers $headers -Body $orgBody -ContentType 'application/json'
$orgId = $org.id
Write-Host "Created org: $($org.name)" -ForegroundColor DarkGray

# ---------- 5. Billing account auto-creates for org ----------
try {
  $billing2 = Invoke-RestMethod "$base/billing/account" -Method Get -Headers $headers
  Test "Billing account for org" ($billing2.plan -eq 'free' -and $null -ne $billing2.auditsLimit)
} catch {
  Test "Billing account for org" $false
}

# ---------- 6. Usage with org ----------
try {
  $usage2 = Invoke-RestMethod "$base/billing/usage" -Method Get -Headers $headers
  Test "Usage with org" ($usage2.audits.limit -eq 3 -and $usage2.users.used -ge 1 -and $usage2.users.limit -eq 1)
} catch {
  Test "Usage with org" $false
}

# ---------- 7. Upgrade to pro ----------
try {
  $upBody = @{ plan="pro" } | ConvertTo-Json
  $up = Invoke-RestMethod "$base/billing/upgrade" -Method Post -Headers $headers -Body $upBody -ContentType 'application/json'
  Test "Upgrade to pro" ($up.billing.plan -eq 'pro' -and $up.planDetails.name -eq 'Pro')
} catch {
  Test "Upgrade to pro" $false
}

# ---------- 8. Usage limits reflect pro plan ----------
try {
  $usage3 = Invoke-RestMethod "$base/billing/usage" -Method Get -Headers $headers
  Test "Pro plan limits" ($usage3.audits.limit -eq 100 -and $usage3.apiCalls.limit -eq 5000)
} catch {
  Test "Pro plan limits" $false
}

# ---------- 9. Upgrade to enterprise ----------
try {
  $entBody = @{ plan="enterprise" } | ConvertTo-Json
  $ent = Invoke-RestMethod "$base/billing/upgrade" -Method Post -Headers $headers -Body $entBody -ContentType 'application/json'
  Test "Upgrade to enterprise" ($ent.billing.plan -eq 'enterprise')
} catch {
  Test "Upgrade to enterprise" $false
}

# ---------- 10. Enterprise has unlimited ----------
try {
  $usage4 = Invoke-RestMethod "$base/billing/usage" -Method Get -Headers $headers
  Test "Enterprise unlimited" ($usage4.audits.limit -eq -1 -and $usage4.users.limit -eq -1)
} catch {
  Test "Enterprise unlimited" $false
}

# ---------- 11. Downgrade back to free ----------
try {
  $downBody = @{ plan="free" } | ConvertTo-Json
  $down = Invoke-RestMethod "$base/billing/upgrade" -Method Post -Headers $headers -Body $downBody -ContentType 'application/json'
  Test "Downgrade to free" ($down.billing.plan -eq 'free')
} catch {
  Test "Downgrade to free" $false
}

# ---------- 12. Billing events logged ----------
try {
  $events = Invoke-RestMethod "$base/billing/events" -Method Get -Headers $headers
  Test "Billing events logged" ($events.events.Count -ge 3) # upgrade, upgrade, downgrade
} catch {
  Test "Billing events logged" $false
}

# ---------- 13. Duplicate plan rejected ----------
try {
  $dupBody = @{ plan="free" } | ConvertTo-Json
  Invoke-RestMethod "$base/billing/upgrade" -Method Post -Headers $headers -Body $dupBody -ContentType 'application/json' -ErrorAction Stop
  Test "Duplicate plan rejected" $false
} catch {
  Test "Duplicate plan rejected" $true
}

# ---------- 14. Invalid plan rejected ----------
try {
  $badBody = @{ plan="platinum" } | ConvertTo-Json
  Invoke-RestMethod "$base/billing/upgrade" -Method Post -Headers $headers -Body $badBody -ContentType 'application/json' -ErrorAction Stop
  Test "Invalid plan rejected" $false
} catch {
  Test "Invalid plan rejected" $true
}

# ---------- 15. Audit creates & increments usage ----------
try {
  # Upload an audit
  $boundary = "----TB$(Get-Random)"
  $contract = "DPA contract for billing test."
  $bb = [System.Text.Encoding]::UTF8.GetBytes("--$boundary`r`nContent-Disposition: form-data; name=`"contract`"; filename=`"billing-test.txt`"`r`nContent-Type: text/plain`r`n`r`n$contract`r`n--$boundary--`r`n")
  Invoke-RestMethod "$base/audits" -Method Post -Headers $headers -ContentType "multipart/form-data; boundary=$boundary" -Body $bb | Out-Null
  Start-Sleep -Seconds 2
  $usage5 = Invoke-RestMethod "$base/billing/usage" -Method Get -Headers $headers
  Test "Audit increments usage" ($usage5.audits.used -ge 1)
} catch {
  Test "Audit increments usage" $false
}

# ---------- 16. Billing portal endpoint ----------
try {
  $portal = Invoke-RestMethod "$base/billing/portal" -Method Post -Headers $headers
  Test "Billing portal" ($null -ne $portal.url -and $null -ne $portal.message)
} catch {
  Test "Billing portal" $false
}

# ---------- 17. Stripe webhook mock (invoice.paid) ----------
$webhookSkipped = $false
try {
  $whBody = @{ type="invoice.paid"; data=@{ orgId=$orgId; amount=4900 } } | ConvertTo-Json -Depth 3
  $wh = Invoke-RestMethod "$base/billing/webhook" -Method Post -Body $whBody -ContentType 'application/json'
  Test "Stripe webhook (invoice.paid)" ($wh.received -eq $true)
} catch {
  if ($_.Exception.Response.StatusCode.Value__ -eq 503) {
    Write-Host "  SKIP  Stripe webhook (invoice.paid) (ALLOW_INSECURE_BILLING_WEBHOOKS not set)" -ForegroundColor Yellow
    $webhookSkipped = $true
  } else { Test "Stripe webhook (invoice.paid)" $false }
}

# ---------- 18. Webhook resets usage counters ----------
if ($webhookSkipped) {
  Write-Host "  SKIP  Webhook resets usage (depends on Stripe webhook)" -ForegroundColor Yellow
} else {
  try {
    $usage6 = Invoke-RestMethod "$base/billing/usage" -Method Get -Headers $headers
    Test "Webhook resets usage" ($usage6.audits.used -eq 0)
  } catch {
    Test "Webhook resets usage" $false
  }
}

# ---------- 19. Dashboard HTML loads ----------
try {
  $html = Invoke-WebRequest "http://localhost:3000" -UseBasicParsing -TimeoutSec 2
  Test "Dashboard HTML loads" ($html.StatusCode -eq 200 -and $html.Content.Contains('root'))
} catch {
  Write-Host "  SKIP  Dashboard HTML loads (port 3000 not running)" -ForegroundColor Yellow
}

Write-Host "`n=== Results: $pass passed, $fail failed out of $($pass+$fail) ===" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
