import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("Windows packaging contract", () => {
  it("defines a build:win script for GitHub Actions", () => {
    expect(packageJson.scripts["build:renderer"]).toBe("vite build");
    expect(packageJson.scripts["build:win"]).toBe("npm run build:renderer && electron-builder --win nsis:x64 --publish never");
  });

  it("points Electron at an existing main process entry", () => {
    expect(packageJson.main).toBe("src/main/main.cjs");
    expect(existsSync(resolve(projectRoot, packageJson.main))).toBe(true);
  });

  it("configures electron-builder to produce a Windows NSIS executable", () => {
    expect(packageJson.build.productName).toBe("Denote");
    expect(packageJson.build.publish).toEqual([
      {
        provider: "github",
        owner: "ikouhaha",
        repo: "denote"
      }
    ]);
    expect(packageJson.build.win.signAndEditExecutable).toBe(false);
    expect(packageJson.build.win.target[0]).toMatchObject({
      target: "nsis",
      arch: ["x64"]
    });
  });

  it("ships electron-updater as a runtime dependency", () => {
    expect(packageJson.dependencies).toHaveProperty("electron-updater");
  });

  it("publishes GitHub updater metadata from the release workflow", () => {
    const releaseWorkflow = readFileSync(resolve(projectRoot, ".github/workflows/denote-release.yml"), "utf8");

    expect(releaseWorkflow).toContain("npx electron-builder --win nsis:x64 --publish always");
    expect(releaseWorkflow).toContain("GH_TOKEN: ${{ github.token }}");
    expect(releaseWorkflow).toContain("latest.yml");
    expect(releaseWorkflow).toContain("gh release edit $env:RELEASE_TAG");
    expect(releaseWorkflow.indexOf("npx electron-builder --win nsis:x64 --publish always")).toBeLessThan(
      releaseWorkflow.indexOf("gh release edit $env:RELEASE_TAG")
    );
    expect(releaseWorkflow).not.toContain("gh release create $env:RELEASE_TAG");
    expect(releaseWorkflow).not.toContain("working-directory: denote");
    expect(releaseWorkflow).not.toContain('gh release upload $env:RELEASE_TAG "dist/*.exe"');
  });
});
