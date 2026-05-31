import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const preloadSource = readFileSync(resolve("src/preload/preload.cjs"), "utf8");

describe("Preload source contracts", () => {
  it("exposes draft refinement to the renderer", () => {
    expect(preloadSource).toContain("refineDraft(payload)");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:refineDraft", payload)');
  });
});
