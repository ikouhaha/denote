import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const preloadSource = readFileSync(resolve("src/preload/preload.cjs"), "utf8");

describe("Preload source contracts", () => {
  it("exposes draft refinement to the renderer", () => {
    expect(preloadSource).toContain("refineDraft(payload)");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:refineDraft", payload)');
  });

  it("exposes card status updates to the renderer", () => {
    expect(preloadSource).toContain("updateCardStatus(payload)");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:updateCardStatus", payload)');
  });

  it("exposes diagnostics paths to the renderer", () => {
    expect(preloadSource).toContain("getDiagnostics()");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:getDiagnostics")');
  });
});
