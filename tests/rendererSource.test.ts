import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve("src/renderer-app/src/App.tsx"), "utf8");
const localWorkspaceSource = readFileSync(resolve("src/renderer-app/src/workspaces/LocalWorkspace.tsx"), "utf8");
const settingsWorkspaceSource = readFileSync(resolve("src/renderer-app/src/workspaces/SettingsWorkspace.tsx"), "utf8");
const denoteApiSource = readFileSync(resolve("src/renderer-app/src/lib/denoteApi.ts"), "utf8");
const providerViewsSource = readFileSync(resolve("src/renderer-app/src/lib/providerViews.ts"), "utf8");
const chatRevealSource = readFileSync(resolve("src/renderer-app/src/lib/chatReveal.ts"), "utf8");

describe("React renderer source contracts", () => {
  it("uses local-only navigation and workspaces", () => {
    expect(appSource).toContain("LocalWorkspace");
    expect(appSource).toContain("SettingsWorkspace");
    expect(appSource).toContain('["add", "library", "calendar", "ask", "settings"]');
    expect(providerViewsSource).toContain("getViewTitle");
    expect(`${appSource}${providerViewsSource}`.toLowerCase()).not.toContain("no" + "tion");
  });

  it("keeps Local Ask scoped to local cards", () => {
    expect(localWorkspaceSource).toContain("window.denote.ask");
    expect(localWorkspaceSource).toContain("LocalWorkspace");
    expect(localWorkspaceSource).toContain("LLM answers using saved local cards as context");
    expect(appSource).toContain("Local cards provide context for Ask");
  });

  it("keeps Add focused on capture, generation, and manual review", () => {
    expect(localWorkspaceSource).toContain("generateDraft");
    expect(localWorkspaceSource).toContain("LocalCardForm");
    expect(localWorkspaceSource).not.toContain("draftQuestionInput");
    expect(localWorkspaceSource).not.toContain("refineDraftButton");
    expect(localWorkspaceSource).not.toContain("Refine generated card");
    expect(localWorkspaceSource).not.toContain("window.denote.refineDraft");
  });

  it("keeps the Local Library free of external provider filters", () => {
    expect(localWorkspaceSource).toContain("libraryFilterInput");
    expect(localWorkspaceSource).toContain("matchesLocalSearch");
    expect(localWorkspaceSource.toLowerCase()).not.toContain("no" + "tion");
  });

  it("renders assistant Markdown as React elements without raw HTML", () => {
    expect(localWorkspaceSource).toContain("MarkdownMessage");
    const markdownMessageSource = readFileSync(resolve("src/renderer-app/src/components/MarkdownMessage.tsx"), "utf8");
    expect(markdownMessageSource).toContain("markdown-table");
    expect(markdownMessageSource).toContain("window.denote.openExternal");
    expect(markdownMessageSource).toContain("https?:");
    expect(`${appSource}${localWorkspaceSource}`).not.toContain("dangerouslySetInnerHTML");
    expect(`${appSource}${localWorkspaceSource}`).not.toContain("innerHTML");
  });

  it("reveals assistant answers progressively instead of replacing Thinking with a full response", () => {
    expect(localWorkspaceSource).toContain("revealAssistantMessage");
    expect(chatRevealSource).toContain("messageId?: string");
    expect(chatRevealSource).toContain("message.id === nextMessage.id");
    expect(chatRevealSource).toContain("splitRevealChunks");
    expect(chatRevealSource).toContain("REVEAL_INTERVAL_MS");
    expect(chatRevealSource).toContain("replaceStreamingAssistant");
    expect(chatRevealSource).toContain("window.setTimeout");
    expect(localWorkspaceSource).not.toContain('content: answer.text, sources: answer.sources || []');
  });

  it("initializes the Tauri adapter before rendering", () => {
    const mainSource = readFileSync(resolve("src/renderer-app/src/main.tsx"), "utf8");
    expect(mainSource).toContain("installDenoteApi");
    expect(denoteApiSource).toContain("window.denote = denoteApi");
    expect(denoteApiSource).toContain('@tauri-apps/api/core');
    expect(denoteApiSource).toContain('@tauri-apps/api/event');
  });

  it("does not render SFTP sync provider settings", () => {
    expect(settingsWorkspaceSource).toContain("syncProviderInput");
    expect(settingsWorkspaceSource.toLowerCase()).not.toContain("sftp");
    expect(denoteApiSource).not.toContain("testSftpConnection");
  });

  it("renders Cloudflare sync settings and actions", () => {
    expect(settingsWorkspaceSource).toContain("cloudflareEndpointInput");
    expect(settingsWorkspaceSource).toContain("cloudflareLicenseKeyInput");
    expect(settingsWorkspaceSource).toContain("cloudflareAutoSyncInput");
    expect(settingsWorkspaceSource).toContain("cloudflareLastSyncedAtInput");
    expect(settingsWorkspaceSource).toContain("testCloudflareSyncButton");
    expect(settingsWorkspaceSource).toContain("syncCloudflareNowButton");
    expect(settingsWorkspaceSource).toContain("window.denote.testCloudflareSyncConnection");
    expect(settingsWorkspaceSource).toContain("window.denote.syncCloudflareNow");
    expect(denoteApiSource).toContain('invoke("test_cloudflare_sync_connection"');
    expect(denoteApiSource).toContain('invoke("sync_cloudflare_now"');
    expect(settingsWorkspaceSource).toContain("normalizeCloudflareSyncSettings");
    expect(settingsWorkspaceSource).toContain("denote-sync-api.ikouhaha888.workers.dev");
    expect(localWorkspaceSource).toContain("sync queued if enabled");
    expect(localWorkspaceSource).toContain("window.denote.onCardsChanged");
  });

  it("retains loading, diagnostics, and update controls", () => {
    expect(appSource).toContain("runAction");
    expect(appSource).toContain("aria-busy");
    expect(appSource).toContain("status-spinner");
    expect(appSource).toContain("window.denote.getDiagnostics");
    expect(appSource).toContain("window.denote.getUpdateState");
    expect(appSource).toContain("window.denote.checkForUpdates");
    expect(appSource).toContain("window.denote.downloadUpdate");
    expect(appSource).toContain("window.denote.installUpdate");
    expect(settingsWorkspaceSource).toContain("diagnosticsText");
  });
});
