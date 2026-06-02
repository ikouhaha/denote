import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bumpVersion, dirtyStatusMessage, parseReleaseArgs } from "./release-lib.mjs";

const denoteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootRepo = resolve(denoteRoot, "..");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? denoteRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio ?? "inherit"
  });
}

function output(command, args, cwd = denoteRoot) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function assertCleanRepo(label, cwd) {
  const status = output("git", ["status", "--porcelain"], cwd);
  const message = dirtyStatusMessage(label, status);
  if (message) {
    throw new Error(message);
  }
}

function assertTagAvailable(tag) {
  const localTag = output("git", ["tag", "--list", tag], denoteRoot);
  if (localTag) {
    throw new Error(`Local tag already exists: ${tag}`);
  }

  const remoteTag = output("git", ["ls-remote", "--tags", "origin", tag], denoteRoot);
  if (remoteTag) {
    throw new Error(`Remote tag already exists: ${tag}`);
  }
}

function readPackageVersion() {
  const packageJson = JSON.parse(readFileSync(resolve(denoteRoot, "package.json"), "utf8"));
  return String(packageJson.version || "");
}

function commitIfDirty(cwd, message, paths) {
  const status = output("git", ["status", "--porcelain", "--", ...paths], cwd);
  if (!status) {
    throw new Error(`No changes found for commit: ${message}`);
  }

  run("git", ["add", ...paths], { cwd });
  run("git", ["commit", "-m", message], { cwd });
}

function main() {
  const options = parseReleaseArgs(process.argv.slice(2));
  const currentVersion = readPackageVersion();
  const nextVersion = bumpVersion(currentVersion, options.releaseType);
  const tag = `v${nextVersion}`;

  console.log(`Denote release: ${currentVersion} -> ${nextVersion}`);
  console.log(`Tag: ${tag}`);
  console.log(`Push: ${options.push ? "yes" : "no"}`);

  assertCleanRepo("Denote", denoteRoot);
  assertCleanRepo("Root", rootRepo);
  assertTagAvailable(tag);

  if (options.dryRun) {
    console.log("Dry run complete. No files changed.");
    return;
  }

  run("node", ["scripts/apply-release-version.mjs"], {
    cwd: denoteRoot,
    env: { RELEASE_TAG: tag }
  });
  run("cargo", ["check"], { cwd: resolve(denoteRoot, "src-tauri") });
  run("npm", ["run", "typecheck"], { cwd: denoteRoot });
  run("npm", ["test"], { cwd: denoteRoot });

  commitIfDirty(denoteRoot, `chore: bump version to ${nextVersion}`, [
    "package.json",
    "package-lock.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/tauri.conf.json"
  ]);
  run("git", ["tag", tag], { cwd: denoteRoot });

  if (options.push) {
    run("git", ["push", "origin", "main"], { cwd: denoteRoot });
    run("git", ["push", "origin", tag], { cwd: denoteRoot });
  }

  commitIfDirty(rootRepo, `chore: record Denote ${tag} tag`, ["denote"]);

  if (options.push) {
    run("git", ["push", "origin", "master"], { cwd: rootRepo });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
