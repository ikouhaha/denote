import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(projectRoot, "..");

describe("Windows packaging contract", () => {
  it("defines a build:win script for GitHub Actions", () => {
    expect(packageJson.scripts["build:win"]).toBe("electron-builder --win nsis:x64 --publish never");
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
        repo: "aidemo"
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
    const releaseWorkflow = readFileSync(resolve(workspaceRoot, ".github/workflows/denote-release.yml"), "utf8");

    expect(releaseWorkflow).toContain("npm run build:win -- --publish always");
    expect(releaseWorkflow).toContain("GH_TOKEN: ${{ github.token }}");
    expect(releaseWorkflow).toContain("latest.yml");
    expect(releaseWorkflow).not.toContain('gh release upload $env:RELEASE_TAG "dist/*.exe"');
  });
});
