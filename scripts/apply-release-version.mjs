import { readFileSync, writeFileSync } from "node:fs";

const releaseTag = process.env.RELEASE_TAG ?? "";
const match = /^v(?<version>\d+\.\d+\.\d+)$/.exec(releaseTag);

if (!match?.groups?.version) {
  throw new Error(`Release tag must look like v0.1.7. Got: ${releaseTag}`);
}

const version = match.groups.version;
const packageJsonPath = "package.json";
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
packageJson.version = version;
writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

const packageLockPath = "package-lock.json";
const packageLock = JSON.parse(readFileSync(packageLockPath, "utf8"));
packageLock.version = version;
if (packageLock.packages?.[""]) {
  packageLock.packages[""].version = version;
}
writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);

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
