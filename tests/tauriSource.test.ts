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
    expect(adapterSource).toContain('invoke("generate_draft"');
    expect(adapterSource).toContain('invoke("save_card"');
    expect(adapterSource).toContain('invoke("ask"');
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
    expect(tauriSource).toContain("x-license-key");
    expect(tauriSource).toContain("cloudflare.sync.success");
    expect(tauriSource).toContain("cloudflare.sync.auto.failed");
    expect(tauriSource).toContain('emit("denote:cardsChanged"');
    expect(adapterSource).toContain('listen<{ reason: string }>("denote:cardsChanged"');
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
});
