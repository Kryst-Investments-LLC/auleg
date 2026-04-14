$ErrorActionPreference = 'Stop'
$base = 'http://localhost:4000/api'
$pass = 0
$fail = 0
$total = 0

function Test($name, $script) {
  $script:total++
  try {
    $result = & $script
    if ($result) {
      $script:pass++
      Write-Host "  PASS: $name" -ForegroundColor Green
    } else {
      $script:fail++
      Write-Host "  FAIL: $name (returned false)" -ForegroundColor Red
    }
  } catch {
    $script:fail++
    Write-Host "  FAIL: $name - $($_.Exception.Message)" -ForegroundColor Red
  }
}

function Api($method, $path, $body = $null, $token = $null) {
  $headers = @{}
  if ($token) { $headers['Authorization'] = "Bearer $token" }

  $params = @{ Method = $method; Uri = "$base$path"; Headers = $headers }
  if ($body -ne $null) {
    $params.Body = ($body | ConvertTo-Json -Depth 20)
    $params.ContentType = 'application/json'
  }

  Invoke-RestMethod @params
}

function ApiRaw($method, $path, $body = $null, $token = $null) {
  $headers = @{}
  if ($token) { $headers['Authorization'] = "Bearer $token" }

  $params = @{ Method = $method; Uri = "$base$path"; Headers = $headers; SkipHttpErrorCheck = $true }
  if ($body -ne $null) {
    $params.Body = ($body | ConvertTo-Json -Depth 20)
    $params.ContentType = 'application/json'
  }

  Invoke-WebRequest @params
}

. "$PSScriptRoot\test-helpers.ps1"

function ParseJson($content) {
  if ([string]::IsNullOrWhiteSpace($content)) {
    return $null
  }

  try {
    return $content | ConvertFrom-Json -Depth 20
  } catch {
    return $null
  }
}

function NewTestUser($label, $suffix) {
  $password = 'Test1234!'
  $email = "$label-$suffix@test.com"
  $body = @{ email = $email; password = $password; name = "$label user" } | ConvertTo-Json
  $response = Auth-Register $base $body

  [pscustomobject]@{
    id = $response.user.id
    email = $email
    password = $password
    token = $response.token
  }
}

function UploadContract($token, $contractPath) {
  $resolvedPath = (Resolve-Path $contractPath).Path
  $client = [System.Net.Http.HttpClient]::new()
  $form = [System.Net.Http.MultipartFormDataContent]::new()
  $fileStream = [System.IO.File]::OpenRead($resolvedPath)
  $streamContent = [System.Net.Http.StreamContent]::new($fileStream)
  $streamContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('text/plain')
  $client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $token)
  $form.Add($streamContent, 'contract', [System.IO.Path]::GetFileName($resolvedPath))

  try {
    $response = $client.PostAsync("$base/audits", $form).Result
    $content = $response.Content.ReadAsStringAsync().Result
    if (-not $response.IsSuccessStatusCode) {
      throw "Upload failed with status $([int]$response.StatusCode): $content"
    }

    return $content | ConvertFrom-Json -Depth 20
  } finally {
    $streamContent.Dispose()
    $fileStream.Dispose()
    $form.Dispose()
    $client.Dispose()
  }
}

function WaitForAudit($token, $auditId, $timeoutSeconds = 45) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  do {
    $audit = Api 'GET' "/audits/$auditId" $null $token
    if ($audit.status -eq 'complete') {
      return $audit
    }
    if ($audit.status -eq 'failed') {
      throw "Audit $auditId failed"
    }

    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  throw "Timed out waiting for audit $auditId to complete"
}

Write-Host "`n=== Phase 11: Security Smoke & Regression E2E ===" -ForegroundColor Cyan

$suffix = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$contractPath = Join-Path $PSScriptRoot '..\test-contracts\sample-dpa.txt'

Write-Host "Preparing scenario users and organization..." -ForegroundColor Yellow
$owner = NewTestUser 'owner' $suffix
$login = Auth-Login $base (@{ email = $owner.email; password = $owner.password } | ConvertTo-Json)
$ownerToken = $login.token
$approver = NewTestUser 'approver' $suffix
$viewer = NewTestUser 'viewer' $suffix
$outsider = NewTestUser 'outsider' $suffix

$org = Api 'POST' '/orgs' @{ name = "Smoke Org $suffix" } $ownerToken
Api 'POST' '/orgs/invite' @{ email = $approver.email; role = 'auditor' } $ownerToken | Out-Null
Api 'POST' '/orgs/invite' @{ email = $viewer.email; role = 'viewer' } $ownerToken | Out-Null
$orgState = Api 'GET' '/orgs/mine' $null $ownerToken

Write-Host "Uploading and processing audit..." -ForegroundColor Yellow
$upload = UploadContract $ownerToken $contractPath
$auditId = $upload.id
$audit = WaitForAudit $ownerToken $auditId

$boardReport = Api 'GET' "/reporting/board-report/$auditId" $null $ownerToken
$gapMatrix = Api 'GET' "/core/gap-matrix/$auditId" $null $ownerToken
$confidence = Api 'GET' "/core/confidence/$auditId" $null $ownerToken
$evidenceEntry = Api 'POST' '/reporting/evidence' @{ auditId = $auditId; action = 'smoke.check'; detail = 'Security smoke evidence entry'; metadata = @{ suite = 'phase11'; auditId = $auditId } } $ownerToken
$evidenceTrail = Api 'GET' "/reporting/evidence/$auditId" $null $ownerToken

Write-Host "Creating webhook and approval workflow..." -ForegroundColor Yellow
$webhook = Api 'POST' '/webhooks' @{ url = 'https://example.com/webhook'; events = 'audit.complete,audit.failed' } $ownerToken
$webhooks = Api 'GET' '/webhooks' $null $ownerToken
$approvalChain = Api 'POST' '/workflow/approvals' @{ auditId = $auditId; steps = @(@{ role = 'auditor'; assignedTo = $approver.id; assignedEmail = $approver.email }) } $ownerToken
$approvalList = Api 'GET' "/workflow/approvals/$auditId" $null $ownerToken
$approvalStepId = $approvalChain.steps[0].id
$viewerDecision = ApiRaw 'POST' "/workflow/approvals/steps/$approvalStepId/decide" @{ decision = 'approved'; comments = 'viewer should be denied' } $viewer.token
$approverDecision = Api 'POST' "/workflow/approvals/steps/$approvalStepId/decide" @{ decision = 'approved'; comments = 'Approved during phase 11 smoke' } $approver.token
$evidencePack = Api 'GET' "/reporting/evidence-pack/$auditId" $null $ownerToken

$outsiderBoard = ApiRaw 'GET' "/reporting/board-report/$auditId" $null $outsider.token
$outsiderGap = ApiRaw 'GET' "/core/gap-matrix/$auditId" $null $outsider.token
$outsiderApprovals = ApiRaw 'GET' "/workflow/approvals/$auditId" $null $outsider.token
$badWebhook = ApiRaw 'POST' '/webhooks' @{ url = 'http://127.0.0.1:4000/internal'; events = 'audit.complete' } $ownerToken
$badIntegration = ApiRaw 'POST' '/integrations' @{ provider = 'slack'; type = 'notification'; config = @{ webhookUrl = 'http://127.0.0.1:4000/hook'; channel = '#security' }; active = $true } $ownerToken

$viewerDecisionBody = ParseJson $viewerDecision.Content
$outsiderBoardBody = ParseJson $outsiderBoard.Content
$outsiderGapBody = ParseJson $outsiderGap.Content
$outsiderApprovalsBody = ParseJson $outsiderApprovals.Content
$badWebhookBody = ParseJson $badWebhook.Content
$badIntegrationBody = ParseJson $badIntegration.Content

Write-Host "`n--- Smoke Checks ---" -ForegroundColor Yellow

Test 'health endpoint is healthy' {
  $health = Api 'GET' '/health'
  $health.status -eq 'healthy'
}

Test 'login returns a token and me reflects the owner' {
  $me = Api 'GET' '/auth/me' $null $ownerToken
  ($login.token.Length -gt 20) -and ($me.email -eq $owner.email) -and ($me.role -eq 'admin')
}

Test 'organization membership reflects invited users' {
  ($org.name -eq "Smoke Org $suffix") -and ($orgState.org.users.Count -eq 3)
}

Test 'uploaded audit completes successfully' {
  ($upload.status -eq 'processing') -and ($audit.status -eq 'complete') -and ($audit.report.risk_profile.score -ge 0)
}

Test 'reporting board report is available for owner' {
  ($boardReport.audit.id -eq $auditId) -and ($boardReport.executiveSummary.riskScore -ge 0)
}

Test 'advanced views are available for same-org approver' {
  $approverBoard = Api 'GET' "/reporting/board-report/$auditId" $null $approver.token
  $approverGap = Api 'GET' "/core/gap-matrix/$auditId" $null $approver.token
  ($approverBoard.audit.id -eq $auditId) -and ($approverGap.auditId -eq $auditId)
}

Test 'confidence and evidence views are available for owner' {
  ($confidence.auditId -eq $auditId) -and ($evidenceEntry.auditId -eq $auditId) -and ($evidenceTrail.evidence.Count -ge 1)
}

Test 'webhook creation and listing work for a safe URL' {
  ($webhook.url -eq 'https://example.com/webhook') -and (($webhooks.webhooks | Where-Object { $_.id -eq $webhook.id }).Count -eq 1)
}

Test 'approval chain is created for the uploaded audit' {
  ($approvalChain.auditId -eq $auditId) -and ($approvalList.chains.Count -ge 1) -and ($approvalStepId.Length -gt 10)
}

Test 'assigned approver can complete the approval step' {
  ($approverDecision.chainStatus -eq 'approved') -and ($evidencePack.approvals[0].status -eq 'approved')
}

Write-Host "`n--- Regression Checks ---" -ForegroundColor Yellow

Test 'unassigned same-org viewer is blocked from approval decision' {
  ($viewerDecision.StatusCode -eq 403) -and ($viewerDecisionBody.error -eq 'You are not assigned to this approval step')
}

Test 'outsider cannot read board report for another org audit' {
  ($outsiderBoard.StatusCode -eq 404) -and ($outsiderBoardBody.error -eq 'Audit not found')
}

Test 'outsider cannot read gap matrix for another org audit' {
  ($outsiderGap.StatusCode -eq 404) -and ($outsiderGapBody.error -eq 'Audit not found')
}

Test 'outsider cannot list approval chains for another org audit' {
  ($outsiderApprovals.StatusCode -eq 404) -and ($outsiderApprovalsBody.error -eq 'Audit not found')
}

Test 'webhook SSRF guard rejects loopback destinations' {
  ($badWebhook.StatusCode -eq 400) -and ($badWebhookBody.error -eq 'Private or loopback destinations are not allowed')
}

Test 'integration SSRF guard rejects loopback destinations' {
  ($badIntegration.StatusCode -eq 400) -and ($badIntegrationBody.error -eq 'Private or loopback destinations are not allowed')
}

Write-Host "`n=== Phase 11 Results: $pass/$total passed ===" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })

if ($fail -gt 0) {
  exit 1
}