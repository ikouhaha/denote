param(
    [string]$Subject = "CN=Denote Internal Test Publisher",
    [string]$TimestampServer = "http://timestamp.digicert.com",
    [switch]$CreateCertificate,
    [switch]$TrustCurrentUser
)

$ErrorActionPreference = "Stop"

function Find-CodeSigningCertificate {
    param([string]$CertificateSubject)

    Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
        Where-Object { $_.Subject -eq $CertificateSubject } |
        Sort-Object NotAfter -Descending |
        Select-Object -First 1
}

function New-DenoteCodeSigningCertificate {
    param([string]$CertificateSubject)

    New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $CertificateSubject `
        -CertStoreLocation Cert:\CurrentUser\My `
        -KeyUsage DigitalSignature `
        -KeyAlgorithm RSA `
        -KeyLength 3072 `
        -HashAlgorithm SHA256 `
        -NotAfter (Get-Date).AddYears(3)
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptRoot "..")
$bundleRoot = Join-Path $projectRoot "src-tauri/target/release/bundle"

$files = @()
$files += Get-ChildItem -Path (Join-Path $bundleRoot "nsis") -Filter "*.exe" -ErrorAction SilentlyContinue
$files += Get-ChildItem -Path (Join-Path $bundleRoot "msi") -Filter "*.msi" -ErrorAction SilentlyContinue

if ($files.Count -eq 0) {
    throw "No Windows release artifacts found under $bundleRoot. Run npm run build:win first."
}

$cert = Find-CodeSigningCertificate -CertificateSubject $Subject
if (-not $cert -and $CreateCertificate) {
    $cert = New-DenoteCodeSigningCertificate -CertificateSubject $Subject
}

if (-not $cert) {
    throw "No code-signing certificate found for '$Subject'. Re-run with -CreateCertificate to create an internal self-signed certificate."
}

if ($TrustCurrentUser) {
    $publicCertificatePath = Join-Path $projectRoot "denote-internal-test.cer"
    Export-Certificate -Cert $cert -FilePath $publicCertificatePath | Out-Null
    Import-Certificate -FilePath $publicCertificatePath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
    Import-Certificate -FilePath $publicCertificatePath -CertStoreLocation Cert:\CurrentUser\TrustedPublisher | Out-Null
    Write-Host "Trusted certificate for current user:" -ForegroundColor Yellow
    Write-Host "  $publicCertificatePath"
}

foreach ($file in $files) {
    $signature = Set-AuthenticodeSignature `
        -FilePath $file.FullName `
        -Certificate $cert `
        -TimestampServer $TimestampServer `
        -HashAlgorithm SHA256

    Write-Host "$($file.Name): $($signature.Status)"
}

Write-Host ""
Write-Host "Verify with:" -ForegroundColor Cyan
Write-Host "  Get-AuthenticodeSignature `"src-tauri\target\release\bundle\nsis\*.exe`""
Write-Host "  Get-AuthenticodeSignature `"src-tauri\target\release\bundle\msi\*.msi`""
