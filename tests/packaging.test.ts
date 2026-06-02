import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriConfig = JSON.parse(readFileSync(resolve(projectRoot, "src-tauri/tauri.conf.json"), "utf8"));

describe("Tauri packaging contract", () => {
  it("defines Tauri scripts for local and CI builds", () => {
    expect(packageJson.scripts.start).toBe("tauri dev");
    expect(packageJson.scripts["build:renderer"]).toBe("vite build");
    expect(packageJson.scripts["build:win"]).toBe("tauri build");
    expect(packageJson.scripts["build:android"]).toBe("tauri android build --apk");
    expect(packageJson.scripts.release).toBe("node scripts/release.mjs");
    expect(packageJson.scripts["release:patch"]).toBe("node scripts/release.mjs patch");
    expect(packageJson.scripts["smoke:llm"]).toBe("node scripts/llm-smoke.mjs");
  });

  it("points Tauri at the generated Vite renderer", () => {
    expect(tauriConfig.productName).toBe("Denote");
    expect(tauriConfig.identifier).toBe("com.denote.desktop");
    expect(tauriConfig.build.frontendDist).toBe("../src/renderer");
    expect(existsSync(resolve(projectRoot, "src-tauri/src/lib.rs"))).toBe(true);
  });

  it("does not ship Electron or SFTP runtime dependencies", () => {
    expect(packageJson.dependencies).not.toHaveProperty("electron-updater");
    expect(packageJson.dependencies).not.toHaveProperty("ssh2-sftp-client");
    expect(packageJson.devDependencies).not.toHaveProperty("electron");
    expect(packageJson.devDependencies).not.toHaveProperty("electron-builder");
  });

  it("builds Windows and Android release artifacts in GitHub Actions", () => {
    const releaseWorkflow = readFileSync(resolve(projectRoot, ".github/workflows/denote-release.yml"), "utf8");

    expect(releaseWorkflow).toContain("npm run build:win");
    expect(releaseWorkflow).toContain("npm run build:android");
    expect(releaseWorkflow).toContain("dtolnay/rust-toolchain@stable");
    expect(releaseWorkflow).toContain("android-actions/setup-android@v3");
    expect(releaseWorkflow).toContain("actions/cache@v5");
    expect(releaseWorkflow).toContain("src-tauri/target/");
    expect(releaseWorkflow).toContain("~/.gradle/caches");
    expect(releaseWorkflow).toContain("actions/upload-artifact@v7");
    expect(releaseWorkflow).toContain("actions/download-artifact@v5");
    expect(releaseWorkflow).toContain("src-tauri/target/release/bundle/nsis/*.exe");
    expect(releaseWorkflow).toContain("Sign Windows artifacts");
    expect(releaseWorkflow).toContain("WINDOWS_CERTIFICATE_BASE64");
    expect(releaseWorkflow).toContain("Set-AuthenticodeSignature");
    expect(releaseWorkflow).not.toContain("TimestampServer");
    expect(releaseWorkflow).not.toContain("timestamp.digicert.com");
    expect(releaseWorkflow).toContain("Set up Android signing");
    expect(releaseWorkflow).toContain("ANDROID_KEY_BASE64");
    expect(releaseWorkflow).toContain("keytool -genkeypair");
    expect(releaseWorkflow).toContain("!src-tauri/gen/android/app/build/outputs/apk/**/*unsigned*.apk");
    expect(releaseWorkflow).toContain("signed Android APK artifact");
    expect(releaseWorkflow).toContain("Update checks open the latest GitHub Release");
    expect(releaseWorkflow).not.toContain("electron-builder");
    expect(releaseWorkflow).not.toContain("latest.yml");
    expect(releaseWorkflow).not.toContain("Tauri updater metadata is not configured");
  });

  it("configures Android release signing", () => {
    const gradleSource = readFileSync(resolve(projectRoot, "src-tauri/gen/android/app/build.gradle.kts"), "utf8");

    expect(gradleSource).toContain("keystore.properties");
    expect(gradleSource).toContain('create("release")');
    expect(gradleSource).toContain("keyAlias");
    expect(gradleSource).toContain("storeFile");
    expect(gradleSource).toContain('signingConfig = signingConfigs.getByName("release")');
  });
});
