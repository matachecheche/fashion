param(
  [string]$EnvPath = (Join-Path $PSScriptRoot ".env")
)
$ErrorActionPreference = "Stop"

Write-Host "=== Configuracion Segura de Proveedor LLM (Groq) para FashionStore ===" -ForegroundColor Cyan
Write-Host "La clave se solicita de forma oculta y se guarda unicamente en $EnvPath (ignorado por Git)."

$ExamplePath = Join-Path $PSScriptRoot ".env.example"
if (-not (Test-Path $EnvPath) -and (Test-Path $ExamplePath)) {
  Copy-Item -Path $ExamplePath -Destination $EnvPath
}

$SecureKey = Read-Host "Ingresa tu GROQ_API_KEY (dejar vacio para usar motor local sin LLM externo)" -AsSecureString
$Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureKey)
try {
  $PlainKey = [Runtime.InteropServices.Marshal]::PtrToStringAuto($Bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
}

$Lines = @()
if (Test-Path $EnvPath) {
  $Lines = Get-Content -Path $EnvPath -Encoding UTF8
}

$Updated = $false
$NewLines = foreach ($line in $Lines) {
  if ($line -match '^\s*GROQ_API_KEY=') {
    $Updated = $true
    "GROQ_API_KEY=$PlainKey"
  } else {
    $line
  }
}
if (-not $Updated) {
  $NewLines += "GROQ_API_KEY=$PlainKey"
}

Set-Content -Path $EnvPath -Value $NewLines -Encoding UTF8
Write-Host "[OK] Configuracion actualizada en $EnvPath sin exponer el secreto en pantalla." -ForegroundColor Green
exit 0
