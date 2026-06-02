export type ReleaseOptions = {
  releaseType: string;
  dryRun: boolean;
  push: boolean;
};

export function parseSemver(version: string): {
  major: number;
  minor: number;
  patch: number;
};

export function bumpVersion(currentVersion: string, releaseType: string): string;

export function parseReleaseArgs(argv: string[]): ReleaseOptions;

export function dirtyStatusMessage(label: string, status: string): string;

export function shellCommand(command: string, platform?: string): string;
