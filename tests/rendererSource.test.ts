import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve("src/renderer-app/src/App.tsx"), "utf8");
const localWorkspaceSource = readFileSync(resolve("src/renderer-app/src/workspaces/LocalWorkspace.tsx"), "utf8");
const settingsWorkspaceSource = readFileSync(resolve("src/renderer-app/src/workspaces/SettingsWorkspace.tsx"), "utf8");
const denoteApiSource = readFileSync(resolve("src/renderer-app/src/lib/denoteApi.ts"), "utf8");
const providerViewsSource = readFileSync(resolve("src/renderer-app/src/lib/providerViews.ts"), "utf8");
const chatRevealSource = readFileSync(resolve("src/renderer-app/src/lib/chatReveal.ts"), "utf8");
const stylesSource = readFileSync(resolve("src/renderer-app/src/styles.css"), "utf8");
const i18nSource = readFileSync(resolve("src/renderer-app/src/lib/i18n.ts"), "utf8");

describe("React renderer source contracts", () => {
  it("uses local-only navigation and workspaces", () => {
    expect(appSource).toContain("LocalWorkspace");
    expect(appSource).toContain("SettingsWorkspace");
    expect(appSource).toContain('["add", "library", "calendar", "ask", "settings"]');
    expect(providerViewsSource).toContain("getViewTitle");
    expect(`${appSource}${providerViewsSource}`.toLowerCase()).not.toContain("no" + "tion");
  });

  it("keeps LocalWorkspace mounted so Ask chat survives tab switches", () => {
    expect(appSource).toContain("<LocalWorkspace language={language} runAction={runAction} setStatus={setStatus} view={view} setView={setView} />");
    expect(appSource).not.toContain('view !== "settings" ? <LocalWorkspace');
    expect(localWorkspaceSource).toContain('if (view === "ask")');
    expect(localWorkspaceSource).toContain("return null;");
  });

  it("keeps Local Ask scoped to local cards", () => {
    expect(localWorkspaceSource).toContain("window.denote.ask");
    expect(localWorkspaceSource).toContain("LocalWorkspace");
    expect(localWorkspaceSource).toContain("t.askHint");
    expect(appSource).toContain("t.sidebarAskContext");
  });

  it("keeps Ask requests compact after repeated questions", () => {
    expect(localWorkspaceSource).toContain("ASK_HISTORY_LIMIT");
    expect(localWorkspaceSource).toContain("buildAskHistory(messages)");
    expect(localWorkspaceSource).toContain('filter((message) => message.role === "user")');
    expect(localWorkspaceSource).toContain(".slice(-ASK_HISTORY_LIMIT)");
    expect(localWorkspaceSource).not.toContain("history: messages");
  });

  it("keeps Add focused on capture, generation, and manual review", () => {
    expect(localWorkspaceSource).toContain("generateDraft");
    expect(localWorkspaceSource).toContain("LocalCardForm");
    expect(localWorkspaceSource).not.toContain("draftQuestionInput");
    expect(localWorkspaceSource).not.toContain("refineDraftButton");
    expect(localWorkspaceSource).not.toContain("Refine generated card");
    expect(localWorkspaceSource).not.toContain("window.denote.refineDraft");
  });

  it("clears edit mode after generating or saving a card from Add", () => {
    expect(localWorkspaceSource.match(/setSelectedCardId\(""\);/g)?.length).toBeGreaterThanOrEqual(3);
    expect(localWorkspaceSource).not.toContain("setSelectedCardId(saved.id)");
    expect(localWorkspaceSource).toContain("const payload = selectedCardId ? { ...draft, id: selectedCardId } : { ...draft };");
    expect(localWorkspaceSource).toContain("setSelectedCardId(card.id)");
    expect(localWorkspaceSource).toContain("function cancelEdit()");
    expect(localWorkspaceSource).toContain("cancelEditButton");
    expect(localWorkspaceSource).toContain("setDraft(emptyDraft)");
    expect(localWorkspaceSource).toContain('setView("library")');
    expect(localWorkspaceSource).toContain("t.editCancelled");
  });

  it("keeps the Local Library free of external provider filters", () => {
    expect(localWorkspaceSource).toContain("libraryFilterInput");
    expect(localWorkspaceSource).toContain("rankLibraryCards");
    expect(localWorkspaceSource).toContain("libraryAiSearchButton");
    expect(localWorkspaceSource).toContain("window.denote.aiSearchCards");
    expect(localWorkspaceSource).toContain("t.editCard");
    expect(localWorkspaceSource.toLowerCase()).not.toContain("no" + "tion");
  });

  it("keeps completed and deleted scheduled cards out of Calendar", () => {
    expect(localWorkspaceSource).toContain(".filter((card) => [\"task\", \"event\", \"reminder\"].includes(card.card_kind || \"knowledge\"))");
    expect(localWorkspaceSource).toContain(".filter((card) => !isDeletedStatus(card.status) && !isDoneStatus(card.status))");
    expect(localWorkspaceSource).toContain("scheduledCards.length");
  });

  it("keeps Ask source cards hidden in the chat UI", () => {
    expect(localWorkspaceSource).not.toContain("message-sources");
    expect(localWorkspaceSource).not.toContain("<blockquote");
    expect(stylesSource).not.toContain(".message-sources");
    expect(localWorkspaceSource).toContain("sources: []");
  });

  it("renders assistant Markdown as React elements without raw HTML", () => {
    expect(localWorkspaceSource).toContain("MarkdownMessage");
    const markdownMessageSource = readFileSync(resolve("src/renderer-app/src/components/MarkdownMessage.tsx"), "utf8");
    expect(markdownMessageSource).toContain("memo(function MarkdownMessage");
    expect(markdownMessageSource).toContain("markdown-table");
    expect(markdownMessageSource).toContain("window.denote.openExternal");
    expect(markdownMessageSource).toContain("https?:");
    expect(`${appSource}${localWorkspaceSource}`).not.toContain("dangerouslySetInnerHTML");
    expect(`${appSource}${localWorkspaceSource}`).not.toContain("innerHTML");
  });

  it("streams Ask answers through Tauri events with buffered renderer updates", () => {
    expect(localWorkspaceSource).toContain("window.denote.askStream");
    expect(localWorkspaceSource).toContain("onAskDelta");
    expect(localWorkspaceSource).toContain("onAskDone");
    expect(localWorkspaceSource).toContain("onAskError");
    expect(localWorkspaceSource).toContain("onAskProgress");
    expect(localWorkspaceSource).toContain("askProgress");
    expect(localWorkspaceSource).toContain("t.askReadingSavedKnowledge");
    expect(localWorkspaceSource).toContain("clearAskConversation");
    expect(localWorkspaceSource).toContain("clearAskButton");
    expect(localWorkspaceSource).toContain("window.denote.clearAskContext");
    expect(localWorkspaceSource).toContain("handleAskKeyDown");
    expect(localWorkspaceSource).toContain('event.key !== "Enter" || event.shiftKey');
    expect(localWorkspaceSource).toContain("event.currentTarget.form?.requestSubmit()");
    expect(denoteApiSource).toContain('listenUntilInactive<AskStreamProgress>("denote:askProgress"');
    expect(denoteApiSource).toContain('invoke("clear_ask_context"');
    expect(localWorkspaceSource).toContain("ASK_STREAM_FLUSH_MS");
    expect(localWorkspaceSource).toContain("streamBufferRef");
    expect(localWorkspaceSource).toContain("appendAssistantMessageDelta");
    expect(localWorkspaceSource).toContain("CHAT_MESSAGE_LIMIT");
    expect(localWorkspaceSource).toContain("trimChatMessages");
    expect(localWorkspaceSource).toContain("createMessageId");
    expect(localWorkspaceSource).toContain("message.id ||");
    expect(localWorkspaceSource).toContain("streaming-placeholder");
    expect(localWorkspaceSource).not.toContain('id="chatThread" className="chat-thread" aria-live="polite"');
    expect(stylesSource).toContain("content-visibility: auto");
    expect(stylesSource).toContain("contain-intrinsic-size: auto 180px");
    expect(localWorkspaceSource).not.toContain("revealAssistantMessage");
    expect(chatRevealSource).toContain("messageId?: string");
    expect(chatRevealSource).toContain("message.id === nextMessage.id");
    expect(chatRevealSource).toContain("appendAssistantMessageDelta");
    expect(chatRevealSource).toContain("preserveExistingContent");
    expect(chatRevealSource).toContain("replaceAssistantMessage");
    expect(localWorkspaceSource).not.toContain('content: answer.text, sources: answer.sources || []');
  });

  it("initializes the Tauri adapter before rendering", () => {
    const mainSource = readFileSync(resolve("src/renderer-app/src/main.tsx"), "utf8");
    expect(mainSource).toContain("installDenoteApi");
    expect(denoteApiSource).toContain("window.denote = denoteApi");
    expect(denoteApiSource).toContain('@tauri-apps/api/core');
    expect(denoteApiSource).toContain('@tauri-apps/api/event');
    expect(denoteApiSource).toContain('invoke("ai_search_cards"');
  });

  it("does not render SFTP sync provider settings", () => {
    expect(settingsWorkspaceSource).toContain("syncProviderInput");
    expect(settingsWorkspaceSource.toLowerCase()).not.toContain("sftp");
    expect(denoteApiSource).not.toContain("testSftpConnection");
  });

  it("renders Cloudflare sync settings and actions", () => {
    expect(settingsWorkspaceSource).toContain("cloudflareLicenseKeyInput");
    expect(settingsWorkspaceSource).toContain("cloudflareAutoSyncInput");
    expect(settingsWorkspaceSource).toContain("cloudflareLastSyncedAtInput");
    expect(settingsWorkspaceSource).toContain("testCloudflareSyncButton");
    expect(settingsWorkspaceSource).toContain("syncCloudflareNowButton");
    expect(settingsWorkspaceSource).toContain("formatSyncTimestamp");
    expect(settingsWorkspaceSource).toContain("window.denote.testCloudflareSyncConnection");
    expect(settingsWorkspaceSource).toContain("window.denote.syncCloudflareNow");
    expect(denoteApiSource).toContain('invoke("test_cloudflare_sync_connection"');
    expect(denoteApiSource).toContain('invoke("sync_cloudflare_now"');
    expect(settingsWorkspaceSource).toContain("normalizeCloudflareSyncSettings");
    expect(settingsWorkspaceSource).toContain("denote-sync-api.ikouhaha888.workers.dev");
    expect(settingsWorkspaceSource).toContain("t.cloudAccount");
    expect(settingsWorkspaceSource).toContain("t.cloudAccountHint");
    expect(settingsWorkspaceSource).toContain("t.cloudSyncDisclosure");
    expect(settingsWorkspaceSource).toContain('type="hidden"');
    expect(settingsWorkspaceSource).not.toContain("cloudflareEndpointInput");
    expect(settingsWorkspaceSource).not.toContain("Cloud endpoint");
    expect(settingsWorkspaceSource).not.toContain("<option value=\"local\">Local only</option>");
    expect(settingsWorkspaceSource).not.toContain("baseUrlInput");
    expect(settingsWorkspaceSource).not.toContain("apiKeyInput");
    expect(settingsWorkspaceSource).not.toContain("chatModelInput");
    expect(settingsWorkspaceSource).not.toContain("embeddingModelInput");
    expect(localWorkspaceSource).toContain("t.cardSaved");
    expect(localWorkspaceSource).toContain("window.denote.onCardsChanged");
  });

  it("lets users reveal and copy stored secrets from settings", () => {
    expect(settingsWorkspaceSource).toContain("SecretInput");
    expect(settingsWorkspaceSource).toContain("visibleSecrets");
    expect(settingsWorkspaceSource).toContain("navigator.clipboard.writeText");
    expect(settingsWorkspaceSource).toContain("document.execCommand");
    expect(settingsWorkspaceSource).toContain("copySecret(t.licenseKey, cloudflare.licenseKey)");
    expect(settingsWorkspaceSource).toContain("setStatus(t.secretCopied(label))");
    expect(settingsWorkspaceSource).toContain('type={isVisible ? "text" : "password"}');
    expect(settingsWorkspaceSource).toContain("secret-action-button");
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
    expect(appSource).toContain("t.openRelease");
    expect(appSource).toContain("t.checkGithubReleases");
    expect(denoteApiSource).toContain("https://github.com/ikouhaha/denote/releases/latest");
    expect(`${appSource}${denoteApiSource}`).not.toContain("Tauri updater is not configured for this build yet.");
    expect(settingsWorkspaceSource).toContain("diagnosticsText");
  });

  it("persists language-aware UI labels through shared i18n messages", () => {
    expect(appSource).toContain('const language = settings?.language || "en";');
    expect(appSource).toContain("getMessages(language)");
    expect(appSource).toContain("getViewTitle(item, language)");
    expect(settingsWorkspaceSource).toContain('id="languageInput"');
    expect(settingsWorkspaceSource).toContain('<option value="en">{t.languageEnglish}</option>');
    expect(settingsWorkspaceSource).toContain('<option value="zh-Hant">{t.languageTraditionalChinese}</option>');
    expect(localWorkspaceSource).toContain("const t = getMessages(language);");
    expect(providerViewsSource).toContain('language: DenoteLanguage = "en"');
    expect(i18nSource).toContain('"zh-Hant"');
    expect(i18nSource).not.toContain('"ja"');
  });
});
