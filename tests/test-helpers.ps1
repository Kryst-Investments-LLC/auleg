# Shared test helpers for E2E suites
# Source this file: . "$PSScriptRoot\test-helpers.ps1"

function Extract-TokenFromCookies($response) {
  # Extract JWT from Set-Cookie header
  $setCookie = $response.Headers['Set-Cookie']
  if ($setCookie -is [array]) { $setCookie = $setCookie -join '; ' }
  if ($setCookie -match 'auleg_session=([^;]+)') { return $matches[1] }
  return $null
}

function Auth-Register($base, $body) {
  $resp = Invoke-WebRequest -Uri "$base/auth/register" -Method POST -Body $body -ContentType 'application/json'
  $data = $resp.Content | ConvertFrom-Json
  $token = Extract-TokenFromCookies $resp
  $data | Add-Member -NotePropertyName 'token' -NotePropertyValue $token -Force
  return $data
}

function Auth-Login($base, $body) {
  $resp = Invoke-WebRequest -Uri "$base/auth/login" -Method POST -Body $body -ContentType 'application/json'
  $data = $resp.Content | ConvertFrom-Json
  $token = Extract-TokenFromCookies $resp
  $data | Add-Member -NotePropertyName 'token' -NotePropertyValue $token -Force
  return $data
}
