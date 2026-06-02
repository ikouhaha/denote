# Denote Release Signing

Denote currently uses two release signing paths:

- Android APK release signing through the Gradle `release` signing config.
- Windows Authenticode signing for NSIS/MSI artifacts.

Self-signing is useful for repeatable builds and internal trust, but it does not make a public Windows download trusted by SmartScreen. Public Windows releases still need a trusted OV or EV code-signing certificate to reduce publisher warnings.

## GitHub CI/CD Secrets

Release builds run in GitHub Actions. The private signing material is stored as GitHub repository secrets, decoded on the runner, used for signing, and never committed.

Set these secrets in:

```text
GitHub repository -> Settings -> Secrets and variables -> Actions -> Repository secrets
```

| Secret | Used by | Value |
| --- | --- | --- |
| `ANDROID_KEY_ALIAS` | Android APK | The key alias inside the JKS keystore, for example `denote-release`. |
| `ANDROID_KEY_PASSWORD` | Android APK | The password for both the Android keystore and key. |
| `ANDROID_KEY_BASE64` | Android APK | Base64 text of the full `.jks` keystore file. |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows EXE/MSI | The password for the Windows `.pfx` code-signing certificate. |
| `WINDOWS_CERTIFICATE_BASE64` | Windows EXE/MSI | Base64 text of the full `.pfx` certificate file, including private key. |

If Windows secrets are missing, CI uploads unsigned Windows artifacts. If Android secrets are missing, CI creates a temporary self-signed sideload keystore so the APK build can still complete.

## Android APK Signing

Android release builds must be signed. Denote's Android Gradle project reads `src-tauri/gen/android/keystore.properties`, which points Gradle at a `.jks` keystore and key alias. The GitHub Actions workflow creates that file at build time.

If these secrets are missing, CI falls back to a temporary self-signed `denote-ci-sideload` keystore. That produces a signed APK, but it is not suitable for long-term releases because a new key can prevent users from upgrading an existing sideloaded install.

### Create A Fixed Android Release Keystore

From `denote/`, run:

```powershell
.\scripts\create-android-release-keystore.ps1
```

The script creates:

```text
src-tauri/gen/android/denote-release.jks
```

The Android generated project already ignores `.jks` files and `keystore.properties`, so the private keystore should not be committed.

The script prints the exact GitHub Secrets to set. Add them in:

```text
GitHub repository -> Settings -> Secrets and variables -> Actions -> Repository secrets
```

Keep the `.jks` file and password backed up. Losing either one means future sideloaded APK updates cannot be signed with the same identity.

### Local Android Release Build

After creating the keystore, the helper also writes:

```text
src-tauri/gen/android/keystore.properties
```

Then build the APK:

```powershell
npm run build:android
```

## Windows Signing

Windows signing in CI uses a `.pfx` certificate stored in GitHub Secrets. A self-signed PFX is fine for internal testing, but it only helps if the target machine trusts the certificate. For public downloads, Windows, browsers, Defender, and SmartScreen may still warn.

### Create A Windows Signing Certificate For CI

From `denote/`, run:

```powershell
.\scripts\create-windows-signing-certificate.ps1
```

The script creates:

```text
denote-windows-signing.pfx
denote-windows-signing.cer
```

It also prints:

```text
WINDOWS_CERTIFICATE_PASSWORD=...
WINDOWS_CERTIFICATE_BASE64=...
```

Add both as GitHub repository secrets. Keep the `.pfx` file and password backed up. Do not commit the `.pfx`; it contains the private key.

The public `.cer` can be imported on internal test machines if you want Windows to trust this self-signed publisher:

```powershell
Import-Certificate -FilePath .\denote-windows-signing.cer -CertStoreLocation Cert:\CurrentUser\Root
Import-Certificate -FilePath .\denote-windows-signing.cer -CertStoreLocation Cert:\CurrentUser\TrustedPublisher
```

### Local Windows Signing

After building Windows artifacts:

```powershell
npm run build:win
```

Create or reuse an internal self-signed certificate and sign the NSIS/MSI artifacts:

```powershell
.\scripts\sign-windows-self-signed.ps1 -CreateCertificate -TrustCurrentUser
```

Use `-TrustCurrentUser` only on test machines where you want the self-signed publisher to be trusted for the current Windows user. For other testers, export and send the public `.cer`; do not send a private key.

### Manual Windows Commands

Create a self-signed code-signing certificate:

```powershell
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=Denote Internal Test Publisher" `
  -CertStoreLocation Cert:\CurrentUser\My `
  -KeyUsage DigitalSignature `
  -KeyAlgorithm RSA `
  -KeyLength 3072 `
  -HashAlgorithm SHA256 `
  -NotAfter (Get-Date).AddYears(3)
```

Export the public certificate and import it on test machines:

```powershell
Export-Certificate -Cert $cert -FilePath .\denote-internal-test.cer
Import-Certificate -FilePath .\denote-internal-test.cer -CertStoreLocation Cert:\CurrentUser\Root
Import-Certificate -FilePath .\denote-internal-test.cer -CertStoreLocation Cert:\CurrentUser\TrustedPublisher
```

Sign a built installer:

```powershell
Set-AuthenticodeSignature `
  -FilePath .\src-tauri\target\release\bundle\nsis\Denote_0.1.5_x64-setup.exe `
  -Certificate $cert `
  -TimestampServer "http://timestamp.digicert.com" `
  -HashAlgorithm SHA256
```

Verify:

```powershell
Get-AuthenticodeSignature .\src-tauri\target\release\bundle\nsis\Denote_0.1.5_x64-setup.exe
```

Expected result on a machine that trusts the certificate is `Valid`. On machines that do not trust the self-signed certificate, the signature can still show as untrusted.
