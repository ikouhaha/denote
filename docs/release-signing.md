# Denote Release Signing

Denote currently uses two release signing paths:

- Android APK release signing through the Gradle `release` signing config.
- Optional Windows Authenticode self-signing for internal testing only.

Self-signing is useful for repeatable builds and internal trust, but it does not make a public Windows download trusted by SmartScreen. Public Windows releases still need a trusted OV or EV code-signing certificate to reduce publisher warnings.

## Android APK Signing

Android release builds must be signed. Denote's Android Gradle project reads `src-tauri/gen/android/keystore.properties`, which points Gradle at a `.jks` keystore and key alias. The GitHub Actions workflow creates that file at build time.

The release workflow uses these GitHub repository secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_KEY_ALIAS` | The key alias inside the JKS keystore, for example `denote-release`. |
| `ANDROID_KEY_PASSWORD` | The password for both the keystore and the key. Denote's Gradle config uses one shared password. |
| `ANDROID_KEY_BASE64` | Base64 text of the full `.jks` keystore file. |

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

## Windows Internal Self-Signing

Windows self-signing is optional and only helps if the target machine trusts the certificate. For public downloads, Windows, browsers, Defender, and SmartScreen may still warn.

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
