param(
    [string]$Subject = "CN=Denote Internal Test Publisher",
    [string]$PfxPath = "denote-windows-signing.pfx",
    [int]$Years = 3,
    [switch]$TrustCurrentUser,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function New-RandomPassword {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return [Convert]::ToBase64String($bytes).TrimEnd("=")
}

function ConvertTo-Base64SingleLine {
    param([string]$Path)

    $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $Path))
    return [Convert]::ToBase64String($bytes)
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptRoot "..")
$absolutePfxPath = Join-Path $projectRoot $PfxPath
$publicCertificatePath = [System.IO.Path]::ChangeExtension($absolutePfxPath, ".cer")

if ((Test-Path $absolutePfxPath) -and -not $Force) {
    throw "PFX already exists: $absolutePfxPath. Re-run with -Force only if you intentionally want to replace the Windows signing identity."
}

$password = if ($env:WINDOWS_CERTIFICATE_PASSWORD) {
    $env:WINDOWS_CERTIFICATE_PASSWORD
} else {
    New-RandomPassword
}

$securePassword = ConvertTo-SecureString -String $password -Force -AsPlainText

$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $Subject `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears($Years)

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $absolutePfxPath) | Out-Null
Export-PfxCertificate -Cert $cert -FilePath $absolutePfxPath -Password $securePassword | Out-Null
Export-Certificate -Cert $cert -FilePath $publicCertificatePath | Out-Null

if ($TrustCurrentUser) {
    Import-Certificate -FilePath $publicCertificatePath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
    Import-Certificate -FilePath $publicCertificatePath -CertStoreLocation Cert:\CurrentUser\TrustedPublisher | Out-Null
}

$base64 = ConvertTo-Base64SingleLine -Path $absolutePfxPath

Write-Host ""
Write-Host "Windows signing certificate created:" -ForegroundColor Green
Write-Host "  $absolutePfxPath"
Write-Host "Public certificate exported:"
Write-Host "  $publicCertificatePath"
Write-Host ""
Write-Host "Set these GitHub repository secrets:" -ForegroundColor Cyan
Write-Host "WINDOWS_CERTIFICATE_PASSWORD=$password"
Write-Host "WINDOWS_CERTIFICATE_BASE64=$base64"
Write-Host ""
Write-Host "Keep the .pfx file and password backed up. Do not commit them."
