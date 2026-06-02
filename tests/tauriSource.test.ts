import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tauriSource = readFileSync(resolve("src-tauri/src/lib.rs"), "utf8").replace(/\r\n/g, "\n");
const adapterSource = readFileSync(resolve("src/renderer-app/src/lib/denoteApi.ts"), "utf8").replace(/\r\n/g, "\n");
const tauriConfig = readFileSync(resolve("src-tauri/tauri.conf.json"), "utf8");
const parsedTauriConfig = JSON.parse(tauriConfig);

describe("Tauri source contracts", () => {
  it("registers Denote commands behind Tauri invoke", () => {
    expect(tauriSource).toContain("tauri::generate_handler!");
    expect(tauriSource).toContain("generate_draft");
    expect(tauriSource).toContain("save_card");
    expect(tauriSource).toContain("list_cards");
    expect(tauriSource).toContain("ask");
    expect(tauriSource).toContain("ask_stream");
    expect(adapterSource).toContain('invoke("generate_draft"');
    expect(adapterSource).toContain('invoke("save_card"');
    expect(adapterSource).toContain('invoke("ask"');
    expect(adapterSource).toContain('invoke("ask_stream"');
    expect(adapterSource).toContain('listenUntilInactive<AskStreamDelta>("denote:askDelta"');
  });

  it("keeps local storage, diagnostics, and LLM calls in the Rust command boundary", () => {
    expect(tauriSource).toContain("app_data_dir");
    expect(tauriSource).toContain("cards.json");
    expect(tauriSource).toContain("settings.json");
    expect(tauriSource).toContain("denote.log");
    expect(tauriSource).toContain("LLM_TIMEOUT_SECS");
    expect(tauriSource).toContain("llm.request.start");
    expect(tauriSource).toContain("llm.response.success");
  });

  it("streams Ask responses through Tauri events instead of fake frontend reveal", () => {
    expect(tauriSource).toContain("call_chat_completion_stream");
    expect(tauriSource).toContain('"stream": true');
    expect(tauriSource).toContain("bytes_stream");
    expect(tauriSource).toContain("drain_sse_frames");
    expect(tauriSource).toContain("extract_chat_stream_deltas");
    expect(tauriSource).toContain('emit("denote:askDelta"');
    expect(tauriSource).toContain('emit("denote:askDone"');
    expect(tauriSource).toContain('emit("denote:askError"');
  });

  it("keeps Ask history separate from the current question", () => {
    expect(tauriSource).toContain("Current question:");
    expect(tauriSource).toContain("Task: Answer the current question from the retrieval evidence below.");
    expect(tauriSource).toContain("Recent user questions for conversation continuity, not the main task:");
    expect(tauriSource).toContain("never treat them as the task if they conflict with the current question");
    expect(tauriSource).toContain("Saved cards are private retrieval evidence");
    expect(tauriSource).toContain("Use the full source text from selected cards to answer");
    expect(tauriSource).toContain("When the retrieved evidence answers the question, do not ask the user to rephrase");
    expect(tauriSource).toContain("Do not output a card list, context list, source list, citation block, or retrieval summary");
    expect(tauriSource).toContain("AskStreamDone { stream_id: task_stream_id, sources: Vec::new() }");
    expect(tauriSource).toContain("ASK_CONTEXT_CARD_LIMIT: usize = 4");
    expect(tauriSource).not.toContain('parts.push(question)');
    expect(tauriSource).not.toContain('parts.join("\\n")');
  });

  it("uses full source text as authoritative Ask evidence for selected cards", () => {
    expect(tauriSource).toContain("Card metadata helps identify relevance; the full source text is the authoritative evidence for answering.");
    expect(tauriSource).toContain("Do not say you are unsure when the full source text contains the requested details.");
    expect(tauriSource).toContain("Private retrieval evidence from saved cards. Use the full source text to answer");
    expect(tauriSource).toContain("Answer the current question now. If the evidence contains exact details, include them exactly.");
    expect(tauriSource).toContain("Full source text:");
    expect(tauriSource).toContain("card.source_text.trim()");
    expect(tauriSource).not.toContain("ASK_CONTEXT_SOURCE_LIMIT");
    expect(tauriSource).not.toContain("truncate(&card.source_text, ASK_CONTEXT_SOURCE_LIMIT)");
  });

  it("supports AI reranking for Library search", () => {
    expect(tauriSource).toContain("struct AiSearchPayload");
    expect(tauriSource).toContain("async fn ai_search_cards");
    expect(tauriSource).toContain("AI_SEARCH_CANDIDATE_LIMIT");
    expect(tauriSource).toContain("You rerank Denote cards for a library search");
    expect(tauriSource).toContain("source excerpt: {}");
    expect(tauriSource).toContain("truncate(&card.source_text, 420)");
    expect(tauriSource).toContain("ai_search_cards,");
    expect(adapterSource).toContain('invoke("ai_search_cards"');
  });

  it("falls back missing LLM draft fields from pasted source text", () => {
    expect(tauriSource).toContain("normalize_draft_source_text");
    expect(tauriSource).toContain("fallback_source_text.trim()");
    expect(tauriSource).toContain("extract_schedule_from_source");
    expect(tauriSource).toContain("parse_day_month");
    expect(tauriSource).toContain("find_time_after");
    expect(tauriSource).toContain("NaiveDate::from_ymd_opt");
    expect(tauriSource).toContain("date.format(\"%Y-%m-%d\")");
    expect(tauriSource).toContain("is_hhmm");
  });

  it("does not ask the LLM to echo full source text for draft generation", () => {
    expect(tauriSource).toContain("Return only JSON with fields: title, summary, project, card_kind, status, due_date, due_time, tags, content_type.");
    expect(tauriSource).toContain("Do not return source_text");
    expect(tauriSource).toContain("normalize_draft_payload(&parsed, source)");
    expect(tauriSource).not.toContain("fields: title, summary, project, card_kind, status, due_date, due_time, tags, content_type, source_text");
    expect(tauriSource).not.toContain("Preserve the original source_text exactly");
  });

  it("serializes card fields with renderer-compatible snake_case names", () => {
    expect(tauriSource).toContain("#[serde(default)]\nstruct SavedCard");
    expect(tauriSource).not.toContain('#[serde(default, rename_all = "camelCase")]\nstruct SavedCard');
    expect(tauriSource).toContain("source_text: String");
    expect(tauriSource).toContain("due_date: String");
    expect(tauriSource).toContain("due_time: String");
  });

  it("keeps Cloudflare sync in Rust and emits card refresh events", () => {
    expect(tauriSource).toContain("test_cloudflare_sync_connection");
    expect(tauriSource).toContain("sync_cloudflare_now");
    expect(tauriSource).toContain("sync_cloudflare_cards");
    expect(tauriSource).toContain("fetch_remote_provider_settings");
    expect(tauriSource).toContain("normalize_remote_provider_settings");
    expect(tauriSource).toContain("resolve_provider_settings");
    expect(tauriSource).toContain("merge_synced_settings");
    expect(tauriSource).toContain("remoteSettingsApplied");
    expect(tauriSource).toContain('fetch_cloudflare_json(http, settings, "/settings", "GET", None)');
    expect(tauriSource).not.toContain("CLOUDFLARE_SETTINGS_OBJECT_KEY");
    expect(tauriSource).not.toContain('/sync/object/{}", CLOUDFLARE_SETTINGS_OBJECT_KEY');
    expect(tauriSource).toContain("x-license-key");
    expect(tauriSource).toContain("cloudflare.sync.success");
    expect(tauriSource).toContain("cloudflare.sync.auto.failed");
    expect(tauriSource).toContain('emit("denote:cardsChanged"');
    expect(adapterSource).toContain('listen<{ reason: string }>("denote:cardsChanged"');
  });

  it("requires a Cloudflare license before saving cloud settings or using LLM features", () => {
    expect(tauriSource).toContain('require_secret(&settings.cloudflare.license_key, "Cloudflare license key")');
    expect(tauriSource).toContain("require_cloud_license(&local)?");
    expect(tauriSource).toContain("let settings = resolve_provider_settings(&app, &state.http).await?;");
    expect(tauriSource).toContain("Set a Cloudflare license key in Settings before using Denote cloud features.");
  });

  it("removes SFTP from the active Tauri path", () => {
    expect(`${tauriSource}${adapterSource}`.toLowerCase()).not.toContain("sftp");
    expect(adapterSource).not.toContain("testSftpConnection");
  });

  it("keeps draft refinement out of the active renderer command surface", () => {
    expect(adapterSource).not.toContain("refineDraft");
    expect(adapterSource).not.toContain('invoke("refine_draft"');
    expect(tauriSource).not.toContain("refine_draft,");
  });

  it("configures the Tauri app window and bundle targets", () => {
    expect(parsedTauriConfig.identifier).toBe("com.denote.desktop");
    expect(parsedTauriConfig.build.frontendDist).toBe("../src/renderer");
    expect(parsedTauriConfig.bundle.targets).toEqual(["nsis", "msi"]);
    expect(parsedTauriConfig.bundle.android.debugApplicationIdSuffix).toBe(".debug");
  });

  it("checks GitHub Releases instead of exposing an unconfigured updater placeholder", () => {
    expect(tauriSource).toContain("DENOTE_RELEASES_API_URL");
    expect(tauriSource).toContain("https://api.github.com/repos/ikouhaha/denote/releases/latest");
    expect(tauriSource).toContain("GithubRelease");
    expect(tauriSource).toContain("is_newer_version");
    expect(tauriSource).toContain("A newer Denote release is available.");
    expect(tauriSource).toContain("Check GitHub Releases for updates.");
    expect(tauriSource).not.toContain("Tauri updater is not configured for this build yet.");
  });

  it("opens external URLs through the Tauri opener plugin for mobile stability", () => {
    expect(tauriSource).toContain("tauri_plugin_opener::init()");
    expect(tauriSource).toContain("OpenerExt");
    expect(tauriSource).toContain("app.opener().open_url");
    expect(tauriSource).not.toContain("webbrowser::open");
  });
});
