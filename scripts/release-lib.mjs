export function parseSemver(version) {
  const match = /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)$/.exec(version);
  if (!match?.groups) {
    throw new Error(`Version must be SemVer without prefix, for example 0.1.19. Got: ${version}`);
  }

  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch)
  };
}

export function bumpVersion(currentVersion, releaseType) {
  const current = parseSemver(currentVersion);

  if (releaseType === "patch") {
    return `${current.major}.${current.minor}.${current.patch + 1}`;
  }
  if (releaseType === "minor") {
    return `${current.major}.${current.minor + 1}.0`;
  }
  if (releaseType === "major") {
    return `${current.major + 1}.0.0`;
  }
  if (/^\d+\.\d+\.\d+$/.test(releaseType)) {
    parseSemver(releaseType);
    return releaseType;
  }

  throw new Error(`Release type must be patch, minor, major, or an exact version. Got: ${releaseType}`);
}

export function parseReleaseArgs(argv) {
  const options = {
    releaseType: "patch",
    dryRun: false,
    push: true
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--no-push") {
      options.push = false;
    } else if (arg === "--push") {
      options.push = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown release option: ${arg}`);
    } else {
      options.releaseType = arg;
    }
  }

  return options;
}

export function dirtyStatusMessage(label, status) {
  const lines = status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (lines.length === 0) {
    return "";
  }

  return `${label} working tree is not clean:\n${lines.map((line) => `  ${line}`).join("\n")}`;
}

export function shellCommand(command, platform = process.platform) {
  if (platform === "win32" && ["npm", "npx"].includes(command)) {
    return `${command}.cmd`;
  }
  return command;
}
