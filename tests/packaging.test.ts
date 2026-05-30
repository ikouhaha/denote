import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("Windows packaging contract", () => {
  it("defines a build:win script for GitHub Actions", () => {
    expect(packageJson.scripts["build:win"]).toBe("electron-builder --win nsis:x64");
  });

  it("points Electron at an existing main process entry", () => {
    expect(packageJson.main).toBe("src/main/main.cjs");
    expect(existsSync(resolve(projectRoot, packageJson.main))).toBe(true);
  });

  it("configures electron-builder to produce a Windows NSIS executable", () => {
    expect(packageJson.build.productName).toBe("Denote");
    expect(packageJson.build.win.signAndEditExecutable).toBe(false);
    expect(packageJson.build.win.target[0]).toMatchObject({
      target: "nsis",
      arch: ["x64"]
    });
  });
});
