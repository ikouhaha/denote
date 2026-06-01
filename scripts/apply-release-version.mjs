import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const releaseTag = process.env.RELEASE_TAG ?? "";
const match = /^v(?<version>\d+\.\d+\.\d+)$/.exec(releaseTag);

if (!match?.groups?.version) {
  throw new Error(`Release tag must look like v0.1.7. Got: ${releaseTag}`);
}

const version = match.groups.version;
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

if (packageJson.version === version) {
  console.log(`Package metadata already at ${version}`);
} else {
  execFileSync("npm", ["version", version, "--no-git-tag-version"], { stdio: "inherit" });
}

const tauriConfigPath = "src-tauri/tauri.conf.json";
const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
tauriConfig.version = version;
writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);

const cargoManifestPath = "src-tauri/Cargo.toml";
const cargoManifest = readFileSync(cargoManifestPath, "utf8").replace(
  /^version = "[^"]+"/m,
  `version = "${version}"`,
);
writeFileSync(cargoManifestPath, cargoManifest);
