import { describe, expect, it } from "vitest";
import { formatSyncTimestamp } from "../src/renderer-app/src/lib/format.js";

describe("renderer formatting helpers", () => {
  it("formats sync timestamps for display instead of showing raw ISO text", () => {
    const formatted = formatSyncTimestamp("2026-06-01T22:08:29.408Z");

    expect(formatted).not.toBe("2026-06-01T22:08:29.408Z");
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/08|22/);
  });

  it("keeps empty and invalid sync timestamps readable", () => {
    expect(formatSyncTimestamp("")).toBe("Never");
    expect(formatSyncTimestamp("not-a-date")).toBe("not-a-date");
  });
});
