import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rendererAppHtml = readFileSync(resolve("src/renderer-app/index.html"), "utf8");

describe("Renderer HTML contracts", () => {
  it("uses Vite React source as the renderer entry", () => {
    expect(rendererAppHtml).toContain('<div id="root"></div>');
    expect(rendererAppHtml).toContain('type="module"');
    expect(rendererAppHtml).toContain("/src/main.tsx");
  });

  it("keeps Electron renderer output as the packaged target", () => {
    const packageJson = readFileSync(resolve("package.json"), "utf8");
    const viteConfig = readFileSync(resolve("vite.config.ts"), "utf8");

    expect(packageJson).toContain('"build:renderer": "vite build"');
    expect(packageJson).toContain('"start": "npm run build:renderer && electron ."');
    expect(packageJson).toContain('"build:win": "npm run build:renderer && electron-builder');
    expect(viteConfig).toContain('root: "src/renderer-app"');
    expect(viteConfig).toContain('outDir: "../renderer"');
    expect(viteConfig).toContain("tailwindcss()");
    expect(viteConfig).toContain("react()");
  });
});
