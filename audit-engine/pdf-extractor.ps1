param([string]$Path)

if (-not (Test-Path $Path)) {
    throw "File not found: $Path"
}

$ext = [System.IO.Path]::GetExtension($Path).ToLower()

switch ($ext) {
    ".txt" {
        return Get-Content $Path -Raw
    }
    ".pdf" {
        throw "PDF extraction not yet implemented. Convert to .txt for now."
    }
    default {
        throw "Unsupported file type: $ext"
    }
}
