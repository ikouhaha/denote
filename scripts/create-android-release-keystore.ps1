param(
    [string]$Alias = "denote-release",
    [string]$KeystorePath = "src-tauri/gen/android/denote-release.jks",
    [string]$DistinguishedName = "CN=Denote,O=Denote,C=HK",
    [int]$ValidityDays = 10000,
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
$absoluteKeystorePath = Join-Path $projectRoot $KeystorePath
$androidRoot = Join-Path $projectRoot "src-tauri/gen/android"
$keystorePropertiesPath = Join-Path $androidRoot "keystore.properties"

if (-not (Get-Command keytool -ErrorAction SilentlyContinue)) {
    throw "keytool was not found. Install a JDK or run this from a shell where keytool is on PATH."
}

if ((Test-Path $absoluteKeystorePath) -and -not $Force) {
    throw "Keystore already exists: $absoluteKeystorePath. Re-run with -Force only if you intentionally want to replace the release key."
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $absoluteKeystorePath) | Out-Null

$password = if ($env:ANDROID_KEY_PASSWORD) {
    $env:ANDROID_KEY_PASSWORD
} else {
    New-RandomPassword
}

if (Test-Path $absoluteKeystorePath) {
    Remove-Item -LiteralPath $absoluteKeystorePath -Force
}

& keytool -genkeypair -v `
    -keystore $absoluteKeystorePath `
    -storepass $password `
    -keypass $password `
    -alias $Alias `
    -keyalg RSA `
    -keysize 2048 `
    -validity $ValidityDays `
    -dname $DistinguishedName

if ($LASTEXITCODE -ne 0) {
    throw "keytool failed with exit code $LASTEXITCODE."
}

@(
    "keyAlias=$Alias"
    "password=$password"
    "storeFile=$absoluteKeystorePath"
) | Set-Content -Path $keystorePropertiesPath -Encoding UTF8

$base64 = ConvertTo-Base64SingleLine -Path $absoluteKeystorePath

Write-Host ""
Write-Host "Android release keystore created:" -ForegroundColor Green
Write-Host "  $absoluteKeystorePath"
Write-Host ""
Write-Host "Set these GitHub repository secrets:" -ForegroundColor Cyan
Write-Host "ANDROID_KEY_ALIAS=$Alias"
Write-Host "ANDROID_KEY_PASSWORD=$password"
Write-Host "ANDROID_KEY_BASE64=$base64"
Write-Host ""
Write-Host "Local Gradle signing file written:" -ForegroundColor Green
Write-Host "  $keystorePropertiesPath"
Write-Host ""
Write-Host "Keep the .jks file and password backed up. Do not commit them."
