import { describe, expect, it } from "vitest";

const releaseLib = await import("../scripts/release-lib.mjs");

describe("release script helpers", () => {
  it("bumps patch, minor, and major versions", () => {
    expect(releaseLib.bumpVersion("0.1.18", "patch")).toBe("0.1.19");
    expect(releaseLib.bumpVersion("0.1.18", "minor")).toBe("0.2.0");
    expect(releaseLib.bumpVersion("0.1.18", "major")).toBe("1.0.0");
  });

  it("accepts an exact target version", () => {
    expect(releaseLib.bumpVersion("0.1.18", "0.1.25")).toBe("0.1.25");
  });

  it("rejects invalid versions and release types", () => {
    expect(() => releaseLib.bumpVersion("0.1", "patch")).toThrow("Version must be SemVer");
    expect(() => releaseLib.bumpVersion("0.1.18", "beta")).toThrow("Release type must be");
  });

  it("parses release CLI options", () => {
    expect(releaseLib.parseReleaseArgs([])).toEqual({ releaseType: "patch", dryRun: false, push: true });
    expect(releaseLib.parseReleaseArgs(["minor", "--dry-run", "--no-push"])).toEqual({
      releaseType: "minor",
      dryRun: true,
      push: false
    });
  });

  it("formats dirty working tree guard messages", () => {
    expect(releaseLib.dirtyStatusMessage("Denote", "")).toBe("");
    expect(releaseLib.dirtyStatusMessage("Root", " M denote\n?? scratch.txt")).toContain(
      "Root working tree is not clean"
    );
  });

  it("uses cmd.exe for npm subprocesses on Windows", () => {
    expect(releaseLib.commandInvocation("npm", ["run", "test"], "win32")).toEqual({
      command: "cmd.exe",
      args: ["/d", "/c", "npm", "run", "test"]
    });
    expect(releaseLib.commandInvocation("git", ["status"], "win32")).toEqual({ command: "git", args: ["status"] });
    expect(releaseLib.commandInvocation("npm", ["test"], "linux")).toEqual({ command: "npm", args: ["test"] });
  });
});
