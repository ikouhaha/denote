use chrono::{Datelike, Local, NaiveDate, Utc};
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
  collections::{HashMap, HashSet},
  fs,
  path::PathBuf,
  sync::Arc,
  time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;
use url::Url;

const CLOUDFLARE_SYNC_OBJECT_KEY: &str = "cards.json";
const DENOTE_RELEASES_API_URL: &str = "https://api.github.com/repos/ikouhaha/denote/releases/latest";
const DENOTE_RELEASES_PAGE_URL: &str = "https://github.com/ikouhaha/denote/releases/latest";
const LLM_TIMEOUT_SECS: u64 = 120;
const ASK_CONTEXT_CARD_LIMIT: usize = 4;
const AI_SEARCH_CANDIDATE_LIMIT: usize = 12;
const ASK_CONTEXT_SOURCE_EXCERPT_LIMIT: usize = 220;
const ASK_AGENT_MAX_TOOL_ROUNDS: usize = 10;
const ASK_TOOL_SEARCH_LIMIT: usize = 8;
const ASK_TOOL_SOURCE_CHAR_LIMIT: usize = 6000;
const ASK_TOOL_CHUNK_CHAR_LIMIT: usize = 2400;
const ASK_TOOL_MAX_CHUNKS_PER_CALL: usize = 3;

#[derive(Clone)]
struct AppState {
  sync_task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
  ask_context: Arc<Mutex<AskContextState>>,
  http: Client,
}

#[derive(Debug, Clone, Default)]
struct AskContextState {
  active_card_ids: Vec<String>,
  active_card_title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct SavedCard {
  id: String,
  title: String,
  summary: String,
  project: String,
  card_kind: String,
  status: String,
  due_date: String,
  due_time: String,
  tags: Vec<String>,
  content_type: String,
  source_text: String,
  created_at: String,
  updated_at: String,
}

impl Default for SavedCard {
  fn default() -> Self {
    Self {
      id: String::new(),
      title: String::new(),
      summary: String::new(),
      project: String::new(),
      card_kind: "knowledge".into(),
      status: "open".into(),
      due_date: String::new(),
      due_time: String::new(),
      tags: Vec::new(),
      content_type: "technical_note".into(),
      source_text: String::new(),
      created_at: String::new(),
      updated_at: String::new(),
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct StoreFile {
  cards: Vec<SavedCard>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct CloudflareSyncSettings {
  endpoint: String,
  license_key: String,
  auto_sync_enabled: bool,
  last_synced_at: String,
}

impl Default for CloudflareSyncSettings {
  fn default() -> Self {
    Self {
      endpoint: "https://denote-sync-api.ikouhaha888.workers.dev".into(),
      license_key: String::new(),
      auto_sync_enabled: true,
      last_synced_at: String::new(),
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ProviderSettings {
  base_url: String,
  api_key: String,
  chat_model: String,
  embedding_model: String,
  language: String,
  sync_provider: String,
  cloudflare: CloudflareSyncSettings,
  task_provider: String,
}

impl Default for ProviderSettings {
  fn default() -> Self {
    Self {
      base_url: "https://api.openai.com/v1".into(),
      api_key: String::new(),
      chat_model: "gpt-4.1-mini".into(),
      embedding_model: "text-embedding-3-small".into(),
      language: "en".into(),
      sync_provider: "local".into(),
      cloudflare: CloudflareSyncSettings::default(),
      task_provider: "local".into(),
    }
  }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Diagnostics {
  user_data_path: String,
  log_file_path: String,
  cards_file_path: String,
  settings_file_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateState {
  status: String,
  current_version: String,
  available_version: String,
  release_url: String,
  progress: Option<u8>,
  message: String,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
  tag_name: String,
  html_url: String,
}

#[derive(Debug, Deserialize)]
struct AskPayload {
  question: String,
  history: Option<Vec<ChatMessage>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AskStreamPayload {
  stream_id: String,
  question: String,
  history: Option<Vec<ChatMessage>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiSearchPayload {
  query: String,
  filter: Option<String>,
  limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
  role: String,
  content: String,
}

#[derive(Debug, Clone, Serialize)]
struct AskSource {
  card_id: String,
  title: String,
  excerpt: String,
}

#[derive(Debug, Serialize)]
struct AskAnswer {
  text: String,
  sources: Vec<AskSource>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskStreamStarted {
  stream_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskStreamDelta {
  stream_id: String,
  delta: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskStreamDone {
  stream_id: String,
  sources: Vec<AskSource>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskStreamError {
  stream_id: String,
  message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskStreamProgress {
  stream_id: String,
  message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiSearchResult {
  cards: Vec<SavedCard>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudflareConnectionResult {
  connected: bool,
  card_count: usize,
  updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudflareSyncResult {
  synced: bool,
  card_count: usize,
  updated_at: String,
}

#[derive(Debug, Serialize)]
struct DeleteResult {
  deleted: bool,
}

#[derive(Debug, Serialize)]
struct StatusUpdateResult {
  updated: bool,
  card: Option<SavedCard>,
}

#[derive(Debug, Deserialize)]
struct StatusUpdatePayload {
  id: String,
  status: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct LlmMessage {
  role: String,
  #[serde(skip_serializing_if = "String::is_empty")]
  content: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  tool_call_id: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  tool_calls: Option<Vec<LlmToolCall>>,
}

impl LlmMessage {
  fn system(content: impl Into<String>) -> Self {
    Self { role: "system".into(), content: content.into(), tool_call_id: None, tool_calls: None }
  }

  fn user(content: impl Into<String>) -> Self {
    Self { role: "user".into(), content: content.into(), tool_call_id: None, tool_calls: None }
  }

  fn assistant(content: impl Into<String>) -> Self {
    Self { role: "assistant".into(), content: content.into(), tool_call_id: None, tool_calls: None }
  }

  fn assistant_tool_calls(tool_calls: Vec<LlmToolCall>) -> Self {
    Self { role: "assistant".into(), content: String::new(), tool_call_id: None, tool_calls: Some(tool_calls) }
  }

  fn tool(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
    Self { role: "tool".into(), content: content.into(), tool_call_id: Some(tool_call_id.into()), tool_calls: None }
  }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct LlmToolCall {
  id: String,
  #[serde(rename = "type")]
  call_type: String,
  function: LlmToolFunction,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct LlmToolFunction {
  name: String,
  arguments: String,
}

#[tauri::command]
async fn generate_draft(app: AppHandle, state: tauri::State<'_, AppState>, source_text: String) -> Result<SavedCard, String> {
  let source = source_text.trim();
  require_text(source, "Source text")?;
  let settings = resolve_provider_settings(&app, &state.http).await?;

  let text = call_chat_completion(
    &app,
    &state.http,
    &settings,
    vec![
      LlmMessage::system("You convert messy notes into a Denote card. Return only JSON with fields: title, summary, project, card_kind, status, due_date, due_time, tags, content_type. Do not return source_text; the app preserves the pasted source locally. card_kind must be one of knowledge, task, event, reminder. status must be open unless the source says it is done. due_date must be YYYY-MM-DD when the text contains a date or relative date; use the current date context from the user message to resolve words like tomorrow. due_time must be HH:MM 24-hour time or empty. content_type must be one of technical_note, project_note, reference, personal_note, captured_qa, other. tags must be an array of short lowercase strings."),
      LlmMessage::user(format!("Current date: {}\n\nSource text:\n{}", current_local_date(), source)),
    ],
  )
  .await?;

  let parsed = parse_json_object(&text)?;
  normalize_draft_payload(&parsed, source)
}

#[tauri::command]
async fn save_card(app: AppHandle, state: tauri::State<'_, AppState>, card: Value) -> Result<SavedCard, String> {
  let mut store = read_store(&app).await?;
  let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
  let id = card.get("id").and_then(Value::as_str).filter(|value| !value.is_empty()).map(String::from).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
  let existing_index = store.cards.iter().position(|item| item.id == id);
  let existing = existing_index.and_then(|index| store.cards.get(index)).cloned();

  let saved = SavedCard {
    id,
    title: require_text(value_text(&card, "title").trim(), "Title")?.to_string(),
    summary: require_text(value_text(&card, "summary").trim(), "Summary")?.to_string(),
    project: normalize_project(card.get("project").and_then(Value::as_str).unwrap_or_default()),
    card_kind: normalize_card_kind(card.get("card_kind").and_then(Value::as_str).or(existing.as_ref().map(|c| c.card_kind.as_str())).unwrap_or("knowledge")),
    status: normalize_card_status(card.get("status").and_then(Value::as_str).or(existing.as_ref().map(|c| c.status.as_str())).unwrap_or("open")),
    due_date: normalize_schedule_field(card.get("due_date").and_then(Value::as_str).unwrap_or_default()),
    due_time: normalize_schedule_field(card.get("due_time").and_then(Value::as_str).unwrap_or_default()),
    tags: normalize_tags_from_value(card.get("tags")),
    content_type: normalize_content_type(card.get("content_type").and_then(Value::as_str).unwrap_or("technical_note")),
    source_text: require_text(value_text(&card, "source_text").trim(), "Source text")?.to_string(),
    created_at: existing.map(|c| c.created_at).unwrap_or_else(|| now.clone()),
    updated_at: now,
  };

  if let Some(index) = existing_index {
    store.cards[index] = saved.clone();
  } else {
    store.cards.push(saved.clone());
  }
  write_store(&app, &store).await?;
  queue_cloudflare_auto_sync(&app, &state, "card.save".into()).await;
  Ok(saved)
}

#[tauri::command]
async fn delete_card(app: AppHandle, state: tauri::State<'_, AppState>, id: String) -> Result<DeleteResult, String> {
  let mut store = read_store(&app).await?;
  let Some(card) = store.cards.iter_mut().find(|item| item.id == id) else {
    return Ok(DeleteResult { deleted: false });
  };
  card.status = "deleted".into();
  card.updated_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
  write_store(&app, &store).await?;
  queue_cloudflare_auto_sync(&app, &state, "card.delete".into()).await;
  Ok(DeleteResult { deleted: true })
}

#[tauri::command]
async fn update_card_status(app: AppHandle, state: tauri::State<'_, AppState>, payload: StatusUpdatePayload) -> Result<StatusUpdateResult, String> {
  if !matches!(payload.status.as_str(), "open" | "done" | "archived" | "deleted") {
    return Err("Invalid card status".into());
  }
  let mut store = read_store(&app).await?;
  let Some(card) = store.cards.iter_mut().find(|item| item.id == payload.id) else {
    return Ok(StatusUpdateResult { updated: false, card: None });
  };
  card.status = payload.status;
  card.updated_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
  let updated = card.clone();
  write_store(&app, &store).await?;
  queue_cloudflare_auto_sync(&app, &state, "card.status".into()).await;
  Ok(StatusUpdateResult { updated: true, card: Some(updated) })
}

#[tauri::command]
async fn list_cards(app: AppHandle) -> Result<Vec<SavedCard>, String> {
  let mut cards = read_store(&app).await?.cards;
  cards.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
  Ok(cards)
}

#[tauri::command]
async fn ai_search_cards(app: AppHandle, state: tauri::State<'_, AppState>, payload: AiSearchPayload) -> Result<AiSearchResult, String> {
  let query = require_text(payload.query.trim(), "Search query")?.to_string();
  let limit = payload.limit.unwrap_or(6).clamp(1, 8);
  let filter = payload.filter.unwrap_or_else(|| "active".into());
  let cards: Vec<SavedCard> = read_store(&app)
    .await?
    .cards
    .into_iter()
    .filter(|card| matches_library_filter(card, &filter))
    .collect();
  let resolved_schedule = resolve_schedule_query(&query);
  let candidates = select_relevant_cards(&query, &cards, AI_SEARCH_CANDIDATE_LIMIT, resolved_schedule.as_ref());
  if candidates.is_empty() {
    return Ok(AiSearchResult { cards: Vec::new() });
  }

  let settings = resolve_provider_settings(&app, &state.http).await?;
  let candidate_text = candidates
    .iter()
    .enumerate()
    .map(|(index, card)| {
      format!(
        "{}. id: {}\ntitle: {}\nproject: {}\ntags: {}\nsummary: {}\nsource excerpt: {}",
        index + 1,
        card.id,
        card.title,
        if card.project.is_empty() { "No project" } else { &card.project },
        card.tags.join(", "),
        card.summary,
        truncate(&card.source_text, 420)
      )
    })
    .collect::<Vec<_>>()
    .join("\n\n");
  let text = call_chat_completion(
    &app,
    &state.http,
    &settings,
    vec![
      LlmMessage::system("You rerank Denote cards for a library search. Return only JSON: {\"ids\":[\"card-id\"]}. Pick the most relevant card ids in descending relevance. Do not invent ids. Do not explain."),
      LlmMessage::user(format!("Query:\n{}\n\nCandidate cards:\n{}", query, candidate_text)),
    ],
  )
  .await?;
  let parsed = parse_json_object(&text)?;
  let ids = parsed
    .get("ids")
    .and_then(Value::as_array)
    .map(|items| items.iter().filter_map(Value::as_str).map(String::from).collect::<Vec<_>>())
    .unwrap_or_default();
  let by_id: HashMap<String, SavedCard> = candidates.into_iter().map(|card| (card.id.clone(), card)).collect();
  let mut ranked = Vec::new();
  for id in ids {
    if let Some(card) = by_id.get(&id) {
      ranked.push(card.clone());
    }
    if ranked.len() >= limit {
      break;
    }
  }
  if ranked.is_empty() {
    ranked = by_id.into_values().take(limit).collect();
  }
  Ok(AiSearchResult { cards: ranked })
}

#[tauri::command]
async fn ask(app: AppHandle, state: tauri::State<'_, AppState>, payload: AskPayload) -> Result<AskAnswer, String> {
  let request = build_ask_agent_request(&app, payload.question, payload.history).await?;
  let settings = resolve_provider_settings(&app, &state.http).await?;
  let messages = run_ask_agent_tools(&app, &state, &state.http, &settings, request, None).await?;
  let text = call_chat_completion(&app, &state.http, &settings, messages).await?;
  Ok(AskAnswer {
    text,
    sources: Vec::new(),
  })
}

#[tauri::command]
async fn ask_stream(app: AppHandle, state: tauri::State<'_, AppState>, payload: AskStreamPayload) -> Result<AskStreamStarted, String> {
  let stream_id = require_text(payload.stream_id.trim(), "Stream id")?.to_string();
  let request = build_ask_agent_request(&app, payload.question, payload.history).await?;
  let settings = resolve_provider_settings(&app, &state.http).await?;
  let app_handle = app.clone();
  let app_state = state.inner().clone();
  let http = state.http.clone();
  let task_stream_id = stream_id.clone();
  tauri::async_runtime::spawn(async move {
    let result = match run_ask_agent_tools(&app_handle, &app_state, &http, &settings, request, Some(&task_stream_id)).await {
      Ok(messages) => call_chat_completion_stream(&app_handle, &http, &settings, messages, &task_stream_id).await,
      Err(error) => Err(error),
    };
    match result {
      Ok(()) => {
        let _ = app_handle.emit("denote:askDone", AskStreamDone { stream_id: task_stream_id, sources: Vec::new() });
      }
      Err(message) => {
        let _ = app_handle.emit("denote:askError", AskStreamError { stream_id: task_stream_id, message });
      }
    }
  });
  Ok(AskStreamStarted { stream_id })
}

#[tauri::command]
async fn clear_ask_context(state: tauri::State<'_, AppState>) -> Result<(), String> {
  let mut context = state.ask_context.lock().await;
  *context = AskContextState::default();
  Ok(())
}

struct AskRequest {
  question: String,
  messages: Vec<LlmMessage>,
  candidate_cards: Vec<SavedCard>,
  cards: Vec<SavedCard>,
}

async fn build_ask_agent_request(app: &AppHandle, question: String, history: Option<Vec<ChatMessage>>) -> Result<AskRequest, String> {
  let history_text = history
    .unwrap_or_default()
    .into_iter()
    .filter(|message| message.role == "user")
    .map(|message| message.content)
    .collect::<Vec<_>>()
    .join("\n");
  let question = require_text(question.trim(), "Question")?.to_string();
  let cards: Vec<SavedCard> = read_store(&app)
    .await?
    .cards
    .into_iter()
    .filter(|card| normalize_card_status(&card.status) != "deleted")
    .collect();
  let resolved_schedule = resolve_schedule_query(&question);
  let context_cards = select_context_cards(&question, &cards, resolved_schedule.as_ref());
  let context_text = if context_cards.is_empty() {
    "No saved cards matched. Answer normally, and say clearly when the saved library has no supporting evidence.".into()
  } else {
    context_cards.iter().map(format_ask_candidate_card).collect::<Vec<_>>().join("\n\n---\n\n")
  };
  let resolved_schedule_text = resolved_schedule
    .as_ref()
    .map(|resolved| format!("Resolved schedule date: {} ({})", resolved.target_date, resolved.reason))
    .unwrap_or_else(|| "Resolved schedule date: none".into());
  Ok(AskRequest {
    question: question.clone(),
    messages: vec![
      LlmMessage::system("You are Denote, an LLM knowledge assistant with local card tools. Answer the current question directly in concise Markdown. Recent user questions are only for continuity; never treat them as the task if they conflict with the current question. Saved cards are private retrieval evidence. Use local tools to inspect full source text or bounded chunks before answering. When the retrieved evidence answers the question, do not ask the user to rephrase. Do not output a card list, context list, source list, citation block, retrieval summary, tool summary, or hidden reasoning. Card metadata helps identify relevance; tool-read source text is the authoritative evidence for answering. Do not say you are unsure when tool-read source text contains the requested details. Resolve schedule words like today, tomorrow, and the day after tomorrow against the provided current date and resolved schedule date instead of guessing. If the saved library does not contain enough evidence after using tools, say that briefly and answer from general reasoning when appropriate. Do not invent database facts not present in the provided context."),
      LlmMessage::user(format!("Task: Answer the current question from the private RAG candidates below. Use tools to read source text when exact evidence is needed.\n\nCurrent date: {}\n{}\n\nCurrent question:\n{}\n\nRecent user questions for conversation continuity, not the main task:\n{}\n\nPrivate RAG candidate cards. Use tools to read source text when exact evidence is needed; do not list these cards unless explicitly asked:\n{}\n\nAnswer the current question now. If the evidence contains exact details, include them exactly.", current_local_date(), resolved_schedule_text, question, if history_text.trim().is_empty() { "None" } else { history_text.trim() }, context_text)),
    ],
    candidate_cards: context_cards,
    cards,
  })
}

#[tauri::command]
fn get_app_info(app: AppHandle) -> HashMap<&'static str, String> {
  HashMap::from([("version", app.package_info().version.to_string())])
}

fn idle_update_state(app: &AppHandle) -> UpdateState {
  UpdateState {
    status: "idle".into(),
    current_version: app.package_info().version.to_string(),
    available_version: String::new(),
    release_url: DENOTE_RELEASES_PAGE_URL.into(),
    progress: None,
    message: "Check GitHub Releases for updates.".into(),
  }
}

#[tauri::command]
fn get_update_state(app: AppHandle) -> UpdateState {
  idle_update_state(&app)
}

#[tauri::command]
async fn check_for_updates(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<UpdateState, String> {
  let current_version = app.package_info().version.to_string();
  let response = state
    .http
    .get(DENOTE_RELEASES_API_URL)
    .header("User-Agent", "Denote")
    .send()
    .await
    .map_err(error_message)?;
  if !response.status().is_success() {
    return Err(format!("GitHub Releases check failed: {}", response.status()));
  }
  let release = response.json::<GithubRelease>().await.map_err(error_message)?;
  let available_version = release.tag_name.trim_start_matches('v').to_string();
  let release_url = if release.html_url.trim().is_empty() {
    DENOTE_RELEASES_PAGE_URL.into()
  } else {
    release.html_url
  };
  if is_newer_version(&available_version, &current_version) {
    Ok(UpdateState {
      status: "available".into(),
      current_version,
      available_version,
      release_url,
      progress: None,
      message: "A newer Denote release is available.".into(),
    })
  } else {
    Ok(UpdateState {
      status: "idle".into(),
      current_version,
      available_version,
      release_url,
      progress: None,
      message: "Denote is up to date.".into(),
    })
  }
}

#[tauri::command]
fn download_update(app: AppHandle) -> Result<UpdateState, String> {
  let state = idle_update_state(&app);
  open_external(app, DENOTE_RELEASES_PAGE_URL.into())?;
  Ok(UpdateState {
    message: "Opened Denote Releases in your browser.".into(),
    ..state
  })
}

#[tauri::command]
fn install_update(app: AppHandle) -> Result<UpdateState, String> {
  download_update(app)
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<HashMap<&'static str, bool>, String> {
  let parsed = Url::parse(url.trim()).map_err(|_| "External URL is required".to_string())?;
  if !matches!(parsed.scheme(), "http" | "https") {
    return Err("External URL is required".into());
  }
  app.opener().open_url(parsed.as_str(), None::<&str>).map_err(error_message)?;
  Ok(HashMap::from([("opened", true)]))
}

#[tauri::command]
async fn get_settings(app: AppHandle) -> Result<ProviderSettings, String> {
  read_settings(&app).await
}

#[tauri::command]
async fn save_settings(app: AppHandle, settings: Value) -> Result<ProviderSettings, String> {
  let settings = normalize_settings(&settings);
  require_secret(&settings.cloudflare.license_key, "Cloudflare license key")?;
  write_settings(&app, &settings).await?;
  Ok(settings)
}

#[tauri::command]
fn get_diagnostics(app: AppHandle) -> Result<Diagnostics, String> {
  let data = app_data_dir(&app)?;
  Ok(Diagnostics {
    user_data_path: data.display().to_string(),
    log_file_path: data.join("denote.log").display().to_string(),
    cards_file_path: data.join("cards.json").display().to_string(),
    settings_file_path: data.join("settings.json").display().to_string(),
  })
}

#[tauri::command]
async fn test_cloudflare_sync_connection(app: AppHandle, state: tauri::State<'_, AppState>, settings: Option<Value>) -> Result<CloudflareConnectionResult, String> {
  let current = read_settings(&app).await?;
  let config = normalize_cloudflare_settings(settings.as_ref().unwrap_or(&json!({})), Some(&current.cloudflare));
  require_secret(&config.license_key, "Cloudflare sync license key")?;
  let result = test_cloudflare_sync_connection_inner(&app, &state.http, &config).await;
  match result {
    Ok(output) => Ok(output),
    Err(error) => {
      write_log(&app, "error", "cloudflare.sync.connection.failed", json!({ "endpoint": config.endpoint, "error": error })).await;
      Err(format!("Cloudflare sync connection failed: {}", error))
    }
  }
}

#[tauri::command]
async fn sync_cloudflare_now(app: AppHandle, state: tauri::State<'_, AppState>, settings: Option<Value>) -> Result<CloudflareSyncResult, String> {
  let current = read_settings(&app).await?;
  let config = normalize_cloudflare_settings(settings.as_ref().unwrap_or(&json!({})), Some(&current.cloudflare));
  sync_cloudflare_cards(&app, &state.http, &config, "manual").await
}

#[tauri::command]
async fn seed_samples(app: AppHandle) -> Result<HashMap<&'static str, Value>, String> {
  let mut store = read_store(&app).await?;
  let mut existing: HashSet<String> = store.cards.iter().map(|card| card.title.clone()).collect();
  let mut added = 0;
  for sample in sample_cards() {
    if existing.insert(sample.title.clone()) {
      store.cards.push(sample);
      added += 1;
    }
  }
  if added > 0 {
    write_store(&app, &store).await?;
  }
  Ok(HashMap::from([("added", json!(added)), ("cards", json!(store.cards))]))
}

async fn queue_cloudflare_auto_sync(app: &AppHandle, state: &AppState, reason: String) {
  let mut guard = state.sync_task.lock().await;
  if let Some(task) = guard.take() {
    task.abort();
  }
  let app = app.clone();
  let http = state.http.clone();
  *guard = Some(tauri::async_runtime::spawn(async move {
    tokio::time::sleep(Duration::from_secs(1)).await;
    match read_settings(&app).await {
      Ok(settings) if settings.sync_provider == "cloudflare" && settings.cloudflare.auto_sync_enabled && !settings.cloudflare.license_key.is_empty() => {
        if let Err(error) = sync_cloudflare_cards(&app, &http, &settings.cloudflare, &reason).await {
          write_log(&app, "warn", "cloudflare.sync.auto.failed", json!({ "reason": reason, "error": error })).await;
        }
      }
      _ => {}
    }
  }));
}

async fn test_cloudflare_sync_connection_inner(app: &AppHandle, http: &Client, settings: &CloudflareSyncSettings) -> Result<CloudflareConnectionResult, String> {
  fetch_cloudflare(http, settings, "/health", "GET", None, false).await?;
  fetch_remote_provider_settings(http, settings).await?;
  let manifest = fetch_cloudflare_json(http, settings, "/sync/manifest", "GET", None).await?;
  let card_count = count_manifest_cards(&manifest);
  let updated_at = manifest.get("updatedAt").and_then(Value::as_str).unwrap_or_default().to_string();
  write_log(app, "info", "cloudflare.sync.connection.success", json!({ "endpoint": settings.endpoint, "cardCount": card_count, "updatedAt": updated_at })).await;
  Ok(CloudflareConnectionResult { connected: true, card_count, updated_at })
}

async fn sync_cloudflare_cards(app: &AppHandle, http: &Client, settings: &CloudflareSyncSettings, reason: &str) -> Result<CloudflareSyncResult, String> {
  require_secret(&settings.license_key, "Cloudflare sync license key")?;
  let local_settings = read_settings(app).await?;
  let remote_settings = fetch_remote_provider_settings(http, settings).await?;
  let local_store = read_store(app).await?;
  let remote_store = read_cloudflare_cards(http, settings).await?;
  let merged_store = merge_card_stores(local_store, remote_store);
  let updated_at = latest_store_updated_at(&merged_store).unwrap_or_else(|| Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
  let merged_settings = merge_synced_settings(local_settings, remote_settings, settings, &updated_at);
  let manifest = build_cloudflare_manifest(&merged_store, &updated_at);
  fetch_cloudflare_json(http, settings, &format!("/sync/object/{}", CLOUDFLARE_SYNC_OBJECT_KEY), "PUT", Some(json!(merged_store))).await?;
  fetch_cloudflare_json(http, settings, "/sync/manifest", "PUT", Some(manifest)).await?;
  write_store(app, &merged_store).await?;
  write_settings(app, &merged_settings).await?;
  let _ = app.emit("denote:cardsChanged", json!({ "reason": "cloudflare.sync" }));
  write_log(app, "info", "cloudflare.sync.success", json!({ "reason": reason, "endpoint": settings.endpoint, "cardCount": merged_store.cards.len(), "remoteSettingsApplied": true, "updatedAt": updated_at })).await;
  Ok(CloudflareSyncResult { synced: true, card_count: merged_store.cards.len(), updated_at })
}

async fn read_cloudflare_cards(http: &Client, settings: &CloudflareSyncSettings) -> Result<StoreFile, String> {
  match fetch_cloudflare_json(http, settings, &format!("/sync/object/{}", CLOUDFLARE_SYNC_OBJECT_KEY), "GET", None).await {
    Ok(payload) => Ok(StoreFile { cards: payload.get("cards").and_then(Value::as_array).map(|cards| cards.iter().map(normalize_stored_card).collect()).unwrap_or_default() }),
    Err(error) if error.starts_with("HTTP 404") => Ok(StoreFile::default()),
    Err(error) => Err(error),
  }
}

async fn fetch_remote_provider_settings(http: &Client, settings: &CloudflareSyncSettings) -> Result<ProviderSettings, String> {
  let payload = fetch_cloudflare_json(http, settings, "/settings", "GET", None).await?;
  let provider = normalize_remote_provider_settings(&payload, settings);
  require_api_key(&provider)?;
  Ok(provider)
}

async fn fetch_cloudflare_json(http: &Client, settings: &CloudflareSyncSettings, path: &str, method: &str, body: Option<Value>) -> Result<Value, String> {
  let text = fetch_cloudflare(http, settings, path, method, body, true).await?;
  if text.trim().is_empty() {
    Ok(json!({}))
  } else {
    serde_json::from_str(&text).map_err(error_message)
  }
}

async fn fetch_cloudflare(http: &Client, settings: &CloudflareSyncSettings, path: &str, method: &str, body: Option<Value>, auth: bool) -> Result<String, String> {
  let endpoint = Url::parse(&settings.endpoint).and_then(|base| base.join(path.trim_start_matches('/'))).map_err(error_message)?;
  let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(error_message)?;
  let mut request = http.request(method, endpoint);
  if auth {
    request = request.header("x-license-key", &settings.license_key);
  }
  if let Some(body) = body {
    request = request.json(&body);
  }
  let response = request.send().await.map_err(error_message)?;
  let status = response.status();
  let text = response.text().await.map_err(error_message)?;
  if !status.is_success() {
    return Err(format!("HTTP {}{}", status.as_u16(), if text.is_empty() { String::new() } else { format!(": {}", truncate(&text, 180)) }));
  }
  Ok(text)
}

async fn run_ask_agent_tools(app: &AppHandle, state: &AppState, http: &Client, settings: &ProviderSettings, mut request: AskRequest, stream_id: Option<&str>) -> Result<Vec<LlmMessage>, String> {
  apply_ask_context_grounding(state, &mut request).await;
  let mut messages = request.messages;
  let cards = request.cards;
  let tools = ask_tool_definitions();
  for round in 0..ASK_AGENT_MAX_TOOL_ROUNDS {
    emit_ask_progress(app, stream_id, if round == 0 { "Searching saved knowledge" } else { "Reading saved knowledge" });
    let response = call_chat_completion_with_tools(app, http, settings, messages.clone(), &tools).await?;
    if response.tool_calls.is_empty() {
      if !response.content.trim().is_empty() {
        messages.push(LlmMessage::assistant(response.content));
      }
      messages.push(LlmMessage::user("Answer the current question now from the private evidence and any tool results above. Do not list cards, tools, hidden reasoning, or retrieval steps. If exact details are present, include them exactly."));
      return Ok(messages);
    }
    let tool_count = response.tool_calls.len();
    messages.push(LlmMessage::assistant_tool_calls(response.tool_calls.clone()));
    for tool_call in response.tool_calls {
      let progress = ask_tool_progress_message(&tool_call.function.name);
      emit_ask_progress(app, stream_id, progress);
      let result = execute_ask_tool_call(&cards, &tool_call);
      update_ask_context_from_tool_result(state, &result).await;
      messages.push(LlmMessage::tool(tool_call.id, result.to_string()));
    }
    write_log(app, "info", "ask.agent.tools", json!({ "round": round + 1, "toolCount": tool_count })).await;
  }
  messages.push(LlmMessage::user("Ask tool loop reached its limit. Answer the current question now using the evidence already read. Say briefly if the evidence is still insufficient."));
  Ok(messages)
}

async fn apply_ask_context_grounding(state: &AppState, request: &mut AskRequest) {
  let context = state.ask_context.lock().await.clone();
  if !context.active_card_ids.is_empty() && is_context_followup_question(&request.question) {
    let active_cards = context
      .active_card_ids
      .iter()
      .filter_map(|card_id| request.cards.iter().find(|card| &card.id == card_id).cloned())
      .collect::<Vec<_>>();
    if !active_cards.is_empty() {
      let active_text = active_cards.iter().map(format_ask_candidate_card).collect::<Vec<_>>().join("\n\n---\n\n");
      request.candidate_cards = merge_priority_cards(active_cards, request.candidate_cards.clone());
      request.messages.push(LlmMessage::user(format!(
        "Conversation grounding: the current question appears to refer to the previously active card. Prefer these active card ids before doing a broad search. Active card title: {}.\n\n{}",
        if context.active_card_title.is_empty() { "Unknown" } else { &context.active_card_title },
        active_text
      )));
    }
  }
  if !request.candidate_cards.is_empty() {
    update_ask_context_from_cards(state, &request.candidate_cards).await;
  }
}

async fn update_ask_context_from_cards(state: &AppState, cards: &[SavedCard]) {
  let mut context = state.ask_context.lock().await;
  context.active_card_ids = cards.iter().take(ASK_CONTEXT_CARD_LIMIT).map(|card| card.id.clone()).collect();
  context.active_card_title = cards.first().map(|card| card.title.clone()).unwrap_or_default();
}

async fn update_ask_context_from_tool_result(state: &AppState, result: &Value) {
  let Some(card) = result.get("card") else {
    return;
  };
  let Some(card_id) = card.get("id").and_then(Value::as_str).filter(|value| !value.is_empty()) else {
    return;
  };
  let title = card.get("title").and_then(Value::as_str).unwrap_or_default();
  let mut context = state.ask_context.lock().await;
  context.active_card_ids.retain(|id| id != card_id);
  context.active_card_ids.insert(0, card_id.to_string());
  context.active_card_ids.truncate(ASK_CONTEXT_CARD_LIMIT);
  if !title.is_empty() {
    context.active_card_title = title.to_string();
  }
}

fn merge_priority_cards(priority: Vec<SavedCard>, current: Vec<SavedCard>) -> Vec<SavedCard> {
  dedupe_cards(priority.into_iter().chain(current).collect())
    .into_iter()
    .take(ASK_CONTEXT_CARD_LIMIT)
    .collect()
}

fn is_context_followup_question(question: &str) -> bool {
  let lower = question.to_lowercase();
  let terms = [
    "里面", "裡面", "入面", "內文", "內容", "這個", "呢個", "这个", "這張", "呢張", "剛才", "刚才", "上面", "上一個", "上一张", "that one", "this one", "inside", "contents",
  ];
  terms.iter().any(|term| lower.contains(term)) && tokenize(question).len() <= 4
}

fn emit_ask_progress(app: &AppHandle, stream_id: Option<&str>, message: &str) {
  if let Some(stream_id) = stream_id {
    let _ = app.emit("denote:askProgress", AskStreamProgress { stream_id: stream_id.to_string(), message: message.to_string() });
  }
}

struct LlmToolResponse {
  content: String,
  tool_calls: Vec<LlmToolCall>,
}

async fn call_chat_completion_with_tools(app: &AppHandle, http: &Client, settings: &ProviderSettings, messages: Vec<LlmMessage>, tools: &[Value]) -> Result<LlmToolResponse, String> {
  let endpoint = format!("{}/chat/completions", settings.base_url);
  write_log(app, "info", "llm.tools.request.start", json!({ "endpoint": endpoint, "model": settings.chat_model, "messageCount": messages.len(), "toolCount": tools.len() })).await;
  let response = http
    .post(&endpoint)
    .bearer_auth(&settings.api_key)
    .timeout(Duration::from_secs(LLM_TIMEOUT_SECS))
    .json(&json!({ "model": settings.chat_model, "messages": messages, "temperature": 0.2, "tools": tools, "tool_choice": "auto" }))
    .send()
    .await
    .map_err(|error| {
      if error.is_timeout() {
        "LLM request timed out. Check provider connectivity and settings.".to_string()
      } else {
        format!("LLM tool request failed: {}", error)
      }
    })?;
  let status = response.status();
  let payload: Value = response.json().await.map_err(error_message)?;
  if !status.is_success() {
    write_log(app, "error", "llm.tools.response.error", json!({ "status": status.as_u16(), "body": truncate(&payload.to_string(), 500) })).await;
    return Err(format!("LLM tool request failed ({}): {}", status.as_u16(), truncate(&payload.to_string(), 240)));
  }
  let message = payload
    .get("choices")
    .and_then(Value::as_array)
    .and_then(|choices| choices.first())
    .and_then(|choice| choice.get("message"))
    .ok_or_else(|| "LLM tool response did not contain message".to_string())?;
  let content = message.get("content").and_then(Value::as_str).unwrap_or_default().trim().to_string();
  let tool_calls = message
    .get("tool_calls")
    .and_then(Value::as_array)
    .map(|items| items.iter().filter_map(parse_llm_tool_call).collect::<Vec<_>>())
    .unwrap_or_default();
  write_log(app, "info", "llm.tools.response.success", json!({ "status": status.as_u16(), "toolCallCount": tool_calls.len(), "contentLength": content.len() })).await;
  Ok(LlmToolResponse { content, tool_calls })
}

async fn call_chat_completion(app: &AppHandle, http: &Client, settings: &ProviderSettings, messages: Vec<LlmMessage>) -> Result<String, String> {
  let endpoint = format!("{}/chat/completions", settings.base_url);
  write_log(app, "info", "llm.request.start", json!({ "endpoint": endpoint, "model": settings.chat_model, "messageCount": messages.len() })).await;
  let response = http
    .post(&endpoint)
    .bearer_auth(&settings.api_key)
    .timeout(Duration::from_secs(LLM_TIMEOUT_SECS))
    .json(&json!({ "model": settings.chat_model, "messages": messages, "temperature": 0.2 }))
    .send()
    .await
    .map_err(|error| {
      if error.is_timeout() {
        "LLM request timed out. Check provider connectivity and settings.".to_string()
      } else {
        format!("LLM request failed: {}", error)
      }
    })?;
  let status = response.status();
  let payload: Value = response.json().await.map_err(error_message)?;
  if !status.is_success() {
    write_log(app, "error", "llm.response.error", json!({ "status": status.as_u16(), "body": truncate(&payload.to_string(), 500) })).await;
    return Err(format!("LLM request failed ({}): {}", status.as_u16(), truncate(&payload.to_string(), 240)));
  }
  let content = payload
    .get("choices")
    .and_then(Value::as_array)
    .and_then(|choices| choices.first())
    .and_then(|choice| choice.get("message"))
    .and_then(|message| message.get("content"))
    .and_then(Value::as_str)
    .ok_or_else(|| "LLM response did not contain message content".to_string())?;
  write_log(app, "info", "llm.response.success", json!({ "status": status.as_u16(), "contentLength": content.len() })).await;
  Ok(content.trim().into())
}

async fn call_chat_completion_stream(app: &AppHandle, http: &Client, settings: &ProviderSettings, messages: Vec<LlmMessage>, stream_id: &str) -> Result<(), String> {
  let endpoint = format!("{}/chat/completions", settings.base_url);
  write_log(app, "info", "llm.stream.start", json!({ "endpoint": endpoint, "model": settings.chat_model, "messageCount": messages.len() })).await;
  let response = http
    .post(&endpoint)
    .bearer_auth(&settings.api_key)
    .timeout(Duration::from_secs(LLM_TIMEOUT_SECS))
    .json(&json!({ "model": settings.chat_model, "messages": messages, "temperature": 0.2, "stream": true }))
    .send()
    .await
    .map_err(|error| {
      if error.is_timeout() {
        "LLM request timed out. Check provider connectivity and settings.".to_string()
      } else {
        format!("LLM stream failed: {}", error)
      }
    })?;
  let status = response.status();
  if !status.is_success() {
    let text = response.text().await.map_err(error_message)?;
    write_log(app, "error", "llm.stream.error", json!({ "status": status.as_u16(), "body": truncate(&text, 500) })).await;
    return Err(format!("LLM stream failed ({}): {}", status.as_u16(), truncate(&text, 240)));
  }

  let mut buffer = String::new();
  let mut content_length = 0usize;
  let mut stream = response.bytes_stream();
  while let Some(chunk) = stream.next().await {
    let chunk = chunk.map_err(|error| format!("LLM stream failed: {}", error))?;
    buffer.push_str(&String::from_utf8_lossy(&chunk));
    let (frames, remainder) = drain_sse_frames(&buffer);
    buffer = remainder;
    for frame in frames {
      if frame == "[DONE]" {
        write_log(app, "info", "llm.stream.success", json!({ "status": status.as_u16(), "contentLength": content_length })).await;
        return Ok(());
      }
      for delta in extract_chat_stream_deltas(&frame) {
        content_length += delta.len();
        let _ = app.emit("denote:askDelta", AskStreamDelta { stream_id: stream_id.to_string(), delta });
      }
    }
  }
  for frame in drain_sse_frames(&(buffer + "\n\n")).0 {
    if frame == "[DONE]" {
      write_log(app, "info", "llm.stream.success", json!({ "status": status.as_u16(), "contentLength": content_length })).await;
      return Ok(());
    }
    for delta in extract_chat_stream_deltas(&frame) {
      content_length += delta.len();
      let _ = app.emit("denote:askDelta", AskStreamDelta { stream_id: stream_id.to_string(), delta });
    }
  }
  write_log(app, "info", "llm.stream.success", json!({ "status": status.as_u16(), "contentLength": content_length })).await;
  Ok(())
}

fn drain_sse_frames(buffer: &str) -> (Vec<String>, String) {
  let normalized = buffer.replace("\r\n", "\n");
  let mut frames = Vec::new();
  let mut remainder = normalized.as_str();
  while let Some(index) = remainder.find("\n\n") {
    let (frame, rest) = remainder.split_at(index);
    let data = frame
      .lines()
      .filter_map(|line| line.strip_prefix("data:"))
      .map(str::trim)
      .collect::<Vec<_>>()
      .join("\n");
    if !data.is_empty() {
      frames.push(data);
    }
    remainder = rest.trim_start_matches('\n');
  }
  (frames, remainder.to_string())
}

fn extract_chat_stream_deltas(frame: &str) -> Vec<String> {
  let Ok(payload) = serde_json::from_str::<Value>(frame) else {
    return Vec::new();
  };
  payload
    .get("choices")
    .and_then(Value::as_array)
    .into_iter()
    .flatten()
    .filter_map(|choice| choice.get("delta").and_then(|delta| delta.get("content")).and_then(Value::as_str))
    .filter(|delta| !delta.is_empty())
    .map(String::from)
    .collect()
}

async fn read_store(app: &AppHandle) -> Result<StoreFile, String> {
  read_json_file(&cards_file_path(app)?, StoreFile::default()).map(|mut store| {
    store.cards = store.cards.iter().map(|card| normalize_stored_card(&json!(card))).collect();
    store
  })
}

async fn write_store(app: &AppHandle, store: &StoreFile) -> Result<(), String> {
  write_json_file(&cards_file_path(app)?, store)
}

async fn read_settings(app: &AppHandle) -> Result<ProviderSettings, String> {
  let settings = match read_json_file::<ProviderSettings>(&settings_file_path(app)?, ProviderSettings::default()) {
    Ok(settings) => settings,
    Err(error) if error.contains("No such file") || error.contains("cannot find") => read_default_settings().await?,
    Err(error) => return Err(error),
  };
  apply_safe_codex_defaults(normalize_settings(&json!(settings))).await
}

async fn write_settings(app: &AppHandle, settings: &ProviderSettings) -> Result<(), String> {
  write_json_file(&settings_file_path(app)?, settings)
}

async fn resolve_provider_settings(app: &AppHandle, http: &Client) -> Result<ProviderSettings, String> {
  let local = read_settings(app).await?;
  require_cloud_license(&local)?;
  let remote = fetch_remote_provider_settings(http, &local.cloudflare).await?;
  let synced_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
  let resolved = merge_synced_settings(local.clone(), remote, &local.cloudflare, &synced_at);
  write_settings(app, &resolved).await?;
  Ok(resolved)
}

fn read_json_file<T>(path: &PathBuf, fallback: T) -> Result<T, String>
where
  T: for<'de> Deserialize<'de>,
{
  match fs::read_to_string(path) {
    Ok(raw) => serde_json::from_str(&raw).map_err(error_message),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(fallback),
    Err(error) => Err(error_message(error)),
  }
}

fn write_json_file<T>(path: &PathBuf, value: &T) -> Result<(), String>
where
  T: Serialize,
{
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(error_message)?;
  }
  fs::write(path, serde_json::to_string_pretty(value).map_err(error_message)?).map_err(error_message)
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
  app.path().app_data_dir().map_err(error_message)
}

fn cards_file_path(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(app_data_dir(app)?.join("cards.json"))
}

fn settings_file_path(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(app_data_dir(app)?.join("settings.json"))
}

fn log_file_path(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(app_data_dir(app)?.join("denote.log"))
}

async fn write_log(app: &AppHandle, level: &str, event: &str, details: Value) {
  if let Ok(path) = log_file_path(app) {
    if let Some(parent) = path.parent() {
      let _ = fs::create_dir_all(parent);
    }
    let mut entry = json!({ "timestamp": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true), "level": level, "event": event });
    if let (Some(target), Some(source)) = (entry.as_object_mut(), details.as_object()) {
      for (key, value) in source {
        target.insert(key.clone(), value.clone());
      }
    }
    let _ = fs::OpenOptions::new().create(true).append(true).open(path).and_then(|mut file| {
      use std::io::Write;
      writeln!(file, "{}", entry)
    });
  }
}

fn normalize_settings(input: &Value) -> ProviderSettings {
  let defaults = ProviderSettings::default();
  ProviderSettings {
    base_url: normalize_base_url(input.get("baseUrl").and_then(Value::as_str).unwrap_or(&defaults.base_url)),
    api_key: input.get("apiKey").and_then(Value::as_str).unwrap_or_default().trim().into(),
    chat_model: input.get("chatModel").and_then(Value::as_str).unwrap_or(&defaults.chat_model).trim().into(),
    embedding_model: input.get("embeddingModel").and_then(Value::as_str).unwrap_or(&defaults.embedding_model).trim().into(),
    language: normalize_language(input.get("language").and_then(Value::as_str).unwrap_or(&defaults.language)),
    sync_provider: normalize_sync_provider(input.get("syncProvider").and_then(Value::as_str).unwrap_or("local")),
    cloudflare: normalize_cloudflare_settings(input.get("cloudflare").unwrap_or(&json!({})), Some(&defaults.cloudflare)),
    task_provider: "local".into(),
  }
}

fn normalize_remote_provider_settings(input: &Value, cloudflare: &CloudflareSyncSettings) -> ProviderSettings {
  let mut settings = normalize_settings(input);
  settings.sync_provider = "cloudflare".into();
  settings.cloudflare.endpoint = cloudflare.endpoint.clone();
  settings.cloudflare.license_key = cloudflare.license_key.clone();
  settings.cloudflare.auto_sync_enabled = cloudflare.auto_sync_enabled;
  settings.cloudflare.last_synced_at = cloudflare.last_synced_at.clone();
  settings.task_provider = "local".into();
  settings
}

fn normalize_cloudflare_settings(input: &Value, fallback: Option<&CloudflareSyncSettings>) -> CloudflareSyncSettings {
  let default = fallback.cloned().unwrap_or_default();
  CloudflareSyncSettings {
    endpoint: CloudflareSyncSettings::default().endpoint,
    license_key: input.get("licenseKey").and_then(Value::as_str).unwrap_or(&default.license_key).trim().into(),
    auto_sync_enabled: input.get("autoSyncEnabled").and_then(Value::as_bool).unwrap_or(default.auto_sync_enabled),
    last_synced_at: input.get("lastSyncedAt").and_then(Value::as_str).unwrap_or(&default.last_synced_at).trim().into(),
  }
}

fn normalize_sync_provider(value: &str) -> String {
  if value == "cloudflare" { "cloudflare".into() } else { "local".into() }
}

fn normalize_language(value: &str) -> String {
  if value == "zh-Hant" { "zh-Hant".into() } else { "en".into() }
}

fn normalize_base_url(value: &str) -> String {
  value.trim().trim_end_matches('/').into()
}

async fn read_default_settings() -> Result<ProviderSettings, String> {
  let codex = read_codex_provider_defaults().await?;
  let mut settings = ProviderSettings::default();
  if let Some(base_url) = codex.get("baseUrl").and_then(Value::as_str) {
    settings.base_url = base_url.into();
  }
  if let Some(chat_model) = codex.get("chatModel").and_then(Value::as_str) {
    settings.chat_model = chat_model.into();
  }
  Ok(settings)
}

async fn apply_safe_codex_defaults(mut settings: ProviderSettings) -> Result<ProviderSettings, String> {
  let defaults = ProviderSettings::default();
  if !settings.api_key.is_empty() || settings.base_url != defaults.base_url || settings.chat_model != defaults.chat_model {
    return Ok(settings);
  }
  let codex = read_codex_provider_defaults().await?;
  if let Some(base_url) = codex.get("baseUrl").and_then(Value::as_str) {
    settings.base_url = base_url.into();
  }
  if let Some(chat_model) = codex.get("chatModel").and_then(Value::as_str) {
    settings.chat_model = chat_model.into();
  }
  Ok(settings)
}

async fn read_codex_provider_defaults() -> Result<Value, String> {
  let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) else {
    return Ok(json!({}));
  };
  let path = PathBuf::from(home).join(".codex").join("config.toml");
  let Ok(raw) = fs::read_to_string(path) else {
    return Ok(json!({}));
  };
  let parsed: toml::Value = toml::from_str(&raw).map_err(error_message)?;
  let provider = parsed.get("model_provider").and_then(toml::Value::as_str);
  let model = parsed.get("model").and_then(toml::Value::as_str);
  let base_url = provider
    .and_then(|provider| parsed.get("model_providers").and_then(|providers| providers.get(provider)))
    .and_then(|provider| provider.get("base_url"))
    .and_then(toml::Value::as_str);
  Ok(json!({
    "baseUrl": base_url.unwrap_or_default(),
    "chatModel": model.unwrap_or_default()
  }))
}

fn normalize_draft_payload(input: &Value, fallback_source_text: &str) -> Result<SavedCard, String> {
  let source_text = normalize_draft_source_text(input.get("source_text").and_then(Value::as_str), fallback_source_text)?;
  let (fallback_due_date, fallback_due_time) = extract_schedule_from_source(&source_text);
  let due_date = normalize_schedule_field(input.get("due_date").and_then(Value::as_str).unwrap_or_default());
  let due_time = normalize_schedule_field(input.get("due_time").and_then(Value::as_str).unwrap_or_default());
  Ok(SavedCard {
    id: input.get("id").and_then(Value::as_str).unwrap_or_default().into(),
    title: require_text(value_text(input, "title").trim(), "Title")?.to_string(),
    summary: require_text(value_text(input, "summary").trim(), "Summary")?.to_string(),
    project: normalize_project(input.get("project").and_then(Value::as_str).unwrap_or_default()),
    card_kind: normalize_card_kind(input.get("card_kind").and_then(Value::as_str).unwrap_or("knowledge")),
    status: normalize_card_status(input.get("status").and_then(Value::as_str).unwrap_or("open")),
    due_date: if due_date.is_empty() { fallback_due_date } else { due_date },
    due_time: if due_time.is_empty() { fallback_due_time } else { due_time },
    tags: normalize_tags_from_value(input.get("tags")),
    content_type: normalize_content_type(input.get("content_type").and_then(Value::as_str).unwrap_or("technical_note")),
    source_text,
    created_at: input.get("created_at").and_then(Value::as_str).unwrap_or_default().into(),
    updated_at: input.get("updated_at").and_then(Value::as_str).unwrap_or_default().into(),
  })
}

fn parse_json_object(text: &str) -> Result<Value, String> {
  let raw = if let Some(start) = text.find("```") {
    let after = &text[start + 3..];
    let after = after.strip_prefix("json").unwrap_or(after).trim_start();
    after.find("```").map(|end| &after[..end]).unwrap_or(text)
  } else {
    text
  };
  let start = raw.find('{').ok_or_else(|| "LLM did not return JSON for the card draft".to_string())?;
  let end = raw.rfind('}').ok_or_else(|| "LLM did not return JSON for the card draft".to_string())?;
  serde_json::from_str(&raw[start..=end]).map_err(error_message)
}

fn normalize_stored_card(input: &Value) -> SavedCard {
  SavedCard {
    id: value_text(input, "id").to_string(),
    title: value_text(input, "title").to_string(),
    summary: value_text(input, "summary").to_string(),
    project: normalize_project(value_text(input, "project")),
    card_kind: normalize_card_kind(value_text(input, "card_kind")),
    status: normalize_card_status(value_text(input, "status")),
    due_date: normalize_schedule_field(value_text(input, "due_date")),
    due_time: normalize_schedule_field(value_text(input, "due_time")),
    tags: normalize_tags_from_value(input.get("tags")),
    content_type: normalize_content_type(value_text(input, "content_type")),
    source_text: value_text(input, "source_text").to_string(),
    created_at: value_text(input, "created_at").to_string(),
    updated_at: value_text(input, "updated_at").to_string(),
  }
}

fn value_text<'a>(input: &'a Value, key: &str) -> &'a str {
  input.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn normalize_draft_source_text(value: Option<&str>, fallback_source_text: &str) -> Result<String, String> {
  let candidate = value.unwrap_or_default().trim();
  if !candidate.is_empty() {
    return Ok(candidate.to_string());
  }
  Ok(require_text(fallback_source_text.trim(), "Source text")?.to_string())
}

fn extract_schedule_from_source(source_text: &str) -> (String, String) {
  let current_year = Local::now().year();
  for token in source_text.split_whitespace() {
    let candidate = token.trim_matches(|character: char| matches!(character, ',' | '.' | ';' | ':' | '(' | ')' | '[' | ']' | '\r' | '\n'));
    let Some((day, month)) = parse_day_month(candidate) else {
      continue;
    };
    if let Some(date) = NaiveDate::from_ymd_opt(current_year, month, day) {
      let due_time = find_time_after(source_text, token).unwrap_or_default();
      return (date.format("%Y-%m-%d").to_string(), due_time);
    }
  }
  (String::new(), String::new())
}

fn parse_day_month(value: &str) -> Option<(u32, u32)> {
  let normalized = value.replace('\u{FF0F}', "/");
  let separator = if normalized.contains('/') { '/' } else if normalized.contains('-') { '-' } else { return None };
  let mut parts = normalized.split(separator);
  let day = parts.next()?.parse::<u32>().ok()?;
  let month = parts.next()?.parse::<u32>().ok()?;
  if parts.next().is_some() || !(1..=31).contains(&day) || !(1..=12).contains(&month) {
    return None;
  }
  Some((day, month))
}

fn find_time_after(source_text: &str, date_token: &str) -> Option<String> {
  let start = source_text.find(date_token).unwrap_or(0);
  let window = source_text.get(start..).unwrap_or(source_text);
  for token in window.split_whitespace().take(8) {
    let candidate = token.trim_matches(|character: char| matches!(character, ',' | '.' | ';' | '(' | ')' | '[' | ']' | '\r' | '\n'));
    if is_hhmm(candidate) {
      return Some(candidate.to_string());
    }
  }
  None
}

fn is_hhmm(value: &str) -> bool {
  let mut parts = value.split(':');
  let Some(hour_text) = parts.next() else { return false };
  let Some(minute_text) = parts.next() else { return false };
  if parts.next().is_some() || hour_text.len() > 2 || minute_text.len() != 2 {
    return false;
  }
  let Ok(hour) = hour_text.parse::<u32>() else { return false };
  let Ok(minute) = minute_text.parse::<u32>() else { return false };
  hour < 24 && minute < 60
}

fn normalize_project(value: &str) -> String {
  value.trim().into()
}

fn normalize_card_kind(value: &str) -> String {
  match value {
    "task" | "event" | "reminder" => value.into(),
    _ => "knowledge".into(),
  }
}

fn normalize_card_status(value: &str) -> String {
  match value {
    "done" | "archived" | "deleted" => value.into(),
    _ => "open".into(),
  }
}

fn normalize_schedule_field(value: &str) -> String {
  value.trim().into()
}

fn normalize_content_type(value: &str) -> String {
  match value {
    "project_note" | "reference" | "personal_note" | "captured_qa" | "other" => value.into(),
    _ => "technical_note".into(),
  }
}

fn normalize_tags_from_value(value: Option<&Value>) -> Vec<String> {
  let tags: Vec<String> = match value {
    Some(Value::Array(items)) => items.iter().filter_map(Value::as_str).map(String::from).collect(),
    Some(Value::String(text)) => text.split(',').map(String::from).collect(),
    _ => Vec::new(),
  };
  let mut seen = HashSet::new();
  tags
    .into_iter()
    .map(|tag| tag.trim().to_lowercase())
    .filter(|tag| !tag.is_empty() && seen.insert(tag.clone()))
    .collect()
}

fn require_text<'a>(value: &'a str, label: &str) -> Result<&'a str, String> {
  if value.trim().is_empty() {
    Err(format!("{} is required", label))
  } else {
    Ok(value)
  }
}

fn require_secret(value: &str, label: &str) -> Result<(), String> {
  if value.is_empty() {
    Err(format!("{} is required", label))
  } else {
    Ok(())
  }
}

fn require_api_key(settings: &ProviderSettings) -> Result<(), String> {
  if settings.api_key.is_empty() {
    Err("Set an API key in Settings before using LLM features.".into())
  } else {
    Ok(())
  }
}

fn require_cloud_license(settings: &ProviderSettings) -> Result<(), String> {
  if settings.cloudflare.license_key.is_empty() {
    Err("Set a Cloudflare license key in Settings before using Denote cloud features.".into())
  } else {
    Ok(())
  }
}

fn merge_card_stores(local_store: StoreFile, remote_store: StoreFile) -> StoreFile {
  let mut cards_by_id: HashMap<String, SavedCard> = HashMap::new();
  for card in remote_store.cards.into_iter().chain(local_store.cards) {
    match cards_by_id.get(&card.id) {
      Some(current) if compare_card_freshness(&card, current) < 0 => {}
      _ => {
        cards_by_id.insert(card.id.clone(), card);
      }
    }
  }
  let mut cards: Vec<SavedCard> = cards_by_id.into_values().collect();
  cards.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
  StoreFile { cards }
}

fn compare_card_freshness(left: &SavedCard, right: &SavedCard) -> i8 {
  match left.updated_at.cmp(&right.updated_at) {
    std::cmp::Ordering::Greater => 1,
    std::cmp::Ordering::Less => -1,
    std::cmp::Ordering::Equal => match left.id.cmp(&right.id) {
      std::cmp::Ordering::Greater => 1,
      std::cmp::Ordering::Less => -1,
      std::cmp::Ordering::Equal => 0,
    },
  }
}

fn latest_store_updated_at(store: &StoreFile) -> Option<String> {
  store.cards.iter().map(|card| card.updated_at.clone()).max().filter(|value| !value.is_empty())
}

fn build_cloudflare_manifest(store: &StoreFile, updated_at: &str) -> Value {
  json!({
    "version": Utc::now().timestamp_millis(),
    "objectKey": CLOUDFLARE_SYNC_OBJECT_KEY,
    "updatedAt": updated_at,
    "cardCount": store.cards.len(),
    "notes": store.cards.iter().map(|card| json!({ "id": card.id, "updated_at": card.updated_at, "status": card.status })).collect::<Vec<_>>(),
    "deleted": store.cards.iter().filter(|card| card.status == "deleted").map(|card| card.id.clone()).collect::<Vec<_>>()
  })
}

fn count_manifest_cards(manifest: &Value) -> usize {
  manifest.get("cardCount").and_then(Value::as_u64).map(|value| value as usize).or_else(|| manifest.get("notes").and_then(Value::as_array).map(Vec::len)).unwrap_or(0)
}

fn merge_synced_settings(
  mut local: ProviderSettings,
  remote: ProviderSettings,
  cloudflare: &CloudflareSyncSettings,
  last_synced_at: &str,
) -> ProviderSettings {
  local.base_url = remote.base_url;
  local.api_key = remote.api_key;
  local.chat_model = remote.chat_model;
  local.embedding_model = remote.embedding_model;
  local.sync_provider = "cloudflare".into();
  local.cloudflare.endpoint = cloudflare.endpoint.clone();
  local.cloudflare.license_key = cloudflare.license_key.clone();
  local.cloudflare.auto_sync_enabled = cloudflare.auto_sync_enabled;
  local.cloudflare.last_synced_at = last_synced_at.into();
  local.task_provider = "local".into();
  normalize_settings(&json!(local))
}

fn select_context_cards(question: &str, cards: &[SavedCard], resolved_schedule: Option<&ResolvedScheduleQuery>) -> Vec<SavedCard> {
  select_relevant_cards(question, cards, ASK_CONTEXT_CARD_LIMIT, resolved_schedule)
}

fn select_relevant_cards(question: &str, cards: &[SavedCard], limit: usize, resolved_schedule: Option<&ResolvedScheduleQuery>) -> Vec<SavedCard> {
  let terms: Vec<String> = tokenize(question).into_iter().filter(|term| !stop_words().contains(term.as_str())).collect();
  let mut selected = Vec::new();
  if is_schedule_question(question) {
    if let Some(target_date) = resolved_schedule.map(|resolved| resolved.target_date.as_str()) {
      let mut exact_date: Vec<SavedCard> = cards
        .iter()
        .filter(|card| matches!(card.card_kind.as_str(), "task" | "event" | "reminder") && card.due_date == target_date)
        .cloned()
        .collect();
      exact_date.sort_by(|a, b| format_due(a).cmp(&format_due(b)).then(b.updated_at.cmp(&a.updated_at)));
      selected.extend(exact_date.into_iter().take(limit));
    }
    let mut schedule: Vec<SavedCard> = cards.iter().filter(|card| matches!(card.card_kind.as_str(), "task" | "event" | "reminder")).cloned().collect();
    schedule.sort_by(|a, b| format_due(a).cmp(&format_due(b)).then(b.updated_at.cmp(&a.updated_at)));
    selected.extend(schedule.into_iter().take(limit));
  }
  let mut ranked: Vec<(SavedCard, usize)> = cards.iter().cloned().map(|card| {
    let haystack = format!("{} {} {} {} {}", card.title, card.summary, card.project, card.tags.join(" "), card.source_text).to_lowercase();
    let score = terms.iter().filter(|term| haystack.contains(term.as_str())).count();
    (card, score)
  }).collect();
  ranked.sort_by(|a, b| b.1.cmp(&a.1).then(b.0.updated_at.cmp(&a.0.updated_at)));
  selected.extend(ranked.into_iter().filter(|(_, score)| *score > 0).take(limit).map(|(card, _)| card));
  if selected.is_empty() {
    selected.extend(cards.iter().take(limit).cloned());
  }
  dedupe_cards(selected).into_iter().take(limit).collect()
}

fn matches_library_filter(card: &SavedCard, filter: &str) -> bool {
  match filter {
    "all" => true,
    "knowledge" => card.card_kind == "knowledge" && normalize_card_status(&card.status) != "deleted",
    "schedule" => matches!(card.card_kind.as_str(), "task" | "event" | "reminder") && normalize_card_status(&card.status) != "deleted",
    "done" => normalize_card_status(&card.status) == "done",
    "trash" => normalize_card_status(&card.status) == "deleted",
    _ => normalize_card_status(&card.status) != "deleted" && normalize_card_status(&card.status) != "done",
  }
}

fn dedupe_cards(cards: Vec<SavedCard>) -> Vec<SavedCard> {
  let mut seen = HashSet::new();
  cards.into_iter().filter(|card| seen.insert(card.id.clone())).collect()
}

fn ask_tool_definitions() -> Vec<Value> {
  vec![
    json!({
      "type": "function",
      "function": {
        "name": "search_cards",
        "description": "Search saved Denote cards by query and return private candidate metadata plus short source excerpts.",
        "parameters": {
          "type": "object",
          "properties": {
            "query": { "type": "string", "description": "Search query for saved cards." },
            "limit": { "type": "integer", "description": "Maximum number of cards to return." }
          },
          "required": ["query"]
        }
      }
    }),
    json!({
      "type": "function",
      "function": {
        "name": "read_card_source",
        "description": "Read a saved card's full source text when it fits the tool payload budget.",
        "parameters": {
          "type": "object",
          "properties": {
            "card_id": { "type": "string", "description": "The saved card id." }
          },
          "required": ["card_id"]
        }
      }
    }),
    json!({
      "type": "function",
      "function": {
        "name": "read_card_chunks",
        "description": "Read bounded chunks from a saved card's source text for long evidence.",
        "parameters": {
          "type": "object",
          "properties": {
            "card_id": { "type": "string", "description": "The saved card id." },
            "start": { "type": "integer", "description": "Zero-based chunk index to start from." },
            "limit": { "type": "integer", "description": "Maximum number of chunks to return." }
          },
          "required": ["card_id"]
        }
      }
    }),
  ]
}

fn parse_llm_tool_call(value: &Value) -> Option<LlmToolCall> {
  Some(LlmToolCall {
    id: value.get("id")?.as_str()?.to_string(),
    call_type: value.get("type").and_then(Value::as_str).unwrap_or("function").to_string(),
    function: LlmToolFunction {
      name: value.get("function")?.get("name")?.as_str()?.to_string(),
      arguments: value.get("function")?.get("arguments").and_then(Value::as_str).unwrap_or("{}").to_string(),
    },
  })
}

fn ask_tool_progress_message(tool_name: &str) -> &'static str {
  match tool_name {
    "search_cards" => "Searching saved cards",
    "read_card_source" => "Reading card source",
    "read_card_chunks" => "Reading long source chunks",
    _ => "Reading saved knowledge",
  }
}

fn execute_ask_tool_call(cards: &[SavedCard], tool_call: &LlmToolCall) -> Value {
  let args: Value = match serde_json::from_str(&tool_call.function.arguments) {
    Ok(value) => value,
    Err(error) => return json!({ "error": format!("Malformed tool arguments: {}", error) }),
  };
  match tool_call.function.name.as_str() {
    "search_cards" => execute_search_cards_tool(cards, &args),
    "read_card_source" => execute_read_card_source_tool(cards, &args),
    "read_card_chunks" => execute_read_card_chunks_tool(cards, &args),
    other => json!({ "error": format!("Unknown Ask tool: {}", other) }),
  }
}

fn execute_search_cards_tool(cards: &[SavedCard], args: &Value) -> Value {
  let query = args.get("query").and_then(Value::as_str).unwrap_or_default().trim();
  if query.is_empty() {
    return json!({ "error": "query is required" });
  }
  let limit = args.get("limit").and_then(Value::as_u64).map(|value| value as usize).unwrap_or(ASK_TOOL_SEARCH_LIMIT).clamp(1, ASK_TOOL_SEARCH_LIMIT);
  let resolved_schedule = resolve_schedule_query(query);
  let results = select_relevant_cards(query, cards, limit, resolved_schedule.as_ref())
    .into_iter()
    .map(|card| ask_card_metadata_json(&card))
    .collect::<Vec<_>>();
  json!({ "cards": results })
}

fn execute_read_card_source_tool(cards: &[SavedCard], args: &Value) -> Value {
  let Some(card) = find_tool_card(cards, args) else {
    return json!({ "error": "card_id was not found" });
  };
  let source = card.source_text.trim();
  if source.chars().count() > ASK_TOOL_SOURCE_CHAR_LIMIT {
    return json!({
      "card": ask_card_metadata_json(card),
      "too_long": true,
      "source_char_count": source.chars().count(),
      "chunk_char_limit": ASK_TOOL_CHUNK_CHAR_LIMIT,
      "message": "Source is too long for read_card_source. Use read_card_chunks with this card_id."
    });
  }
  json!({ "card": ask_card_metadata_json(card), "source_text": source })
}

fn execute_read_card_chunks_tool(cards: &[SavedCard], args: &Value) -> Value {
  let Some(card) = find_tool_card(cards, args) else {
    return json!({ "error": "card_id was not found" });
  };
  let start = args.get("start").and_then(Value::as_u64).map(|value| value as usize).unwrap_or(0);
  let limit = args.get("limit").and_then(Value::as_u64).map(|value| value as usize).unwrap_or(ASK_TOOL_MAX_CHUNKS_PER_CALL).clamp(1, ASK_TOOL_MAX_CHUNKS_PER_CALL);
  let chunks = chunk_source_text(&card.source_text, ASK_TOOL_CHUNK_CHAR_LIMIT);
  let selected = chunks
    .iter()
    .skip(start)
    .take(limit)
    .enumerate()
    .map(|(offset, chunk)| json!({ "index": start + offset, "text": chunk }))
    .collect::<Vec<_>>();
  json!({
    "card": ask_card_metadata_json(card),
    "chunk_char_limit": ASK_TOOL_CHUNK_CHAR_LIMIT,
    "total_chunks": chunks.len(),
    "start": start,
    "chunks": selected,
    "has_more": start + limit < chunks.len()
  })
}

fn find_tool_card<'a>(cards: &'a [SavedCard], args: &Value) -> Option<&'a SavedCard> {
  let card_id = args.get("card_id").and_then(Value::as_str).unwrap_or_default();
  cards.iter().find(|card| card.id == card_id)
}

fn ask_card_metadata_json(card: &SavedCard) -> Value {
  json!({
    "id": card.id,
    "title": card.title,
    "project": if card.project.is_empty() { "No project" } else { &card.project },
    "kind": card.card_kind,
    "status": card.status,
    "due": format_due(card),
    "summary": card.summary,
    "tags": card.tags,
    "source_excerpt": truncate(&card.source_text, ASK_CONTEXT_SOURCE_EXCERPT_LIMIT),
    "source_char_count": card.source_text.chars().count()
  })
}

fn chunk_source_text(source_text: &str, chunk_char_limit: usize) -> Vec<String> {
  let source = source_text.trim();
  if source.is_empty() {
    return Vec::new();
  }
  let mut chunks = Vec::new();
  let mut current = String::new();
  for paragraph in source.split("\n\n") {
    let paragraph = paragraph.trim();
    if paragraph.is_empty() {
      continue;
    }
    if current.chars().count() + paragraph.chars().count() + 2 <= chunk_char_limit {
      if !current.is_empty() {
        current.push_str("\n\n");
      }
      current.push_str(paragraph);
    } else {
      if !current.is_empty() {
        chunks.push(current);
        current = String::new();
      }
      if paragraph.chars().count() <= chunk_char_limit {
        current.push_str(paragraph);
      } else {
        chunks.extend(split_long_text(paragraph, chunk_char_limit));
      }
    }
  }
  if !current.is_empty() {
    chunks.push(current);
  }
  chunks
}

fn split_long_text(value: &str, chunk_char_limit: usize) -> Vec<String> {
  let chars = value.chars().collect::<Vec<_>>();
  chars.chunks(chunk_char_limit).map(|chunk| chunk.iter().collect::<String>()).collect()
}

fn is_schedule_question(question: &str) -> bool {
  let lower = question.to_lowercase();
  ["today", "tomorrow", "upcoming", "schedule", "calendar", "due", "task", "event", "reminder", "日程", "行程", "待辦", "任务", "任務", "今天", "明天", "後天", "下周", "下週"]
    .iter()
    .any(|term| lower.contains(term))
}

#[derive(Debug, Clone)]
struct ResolvedScheduleQuery {
  target_date: String,
  reason: String,
}

fn resolve_schedule_query(question: &str) -> Option<ResolvedScheduleQuery> {
  let today = local_today();
  resolve_schedule_query_with_today(question, today)
}

fn resolve_schedule_query_with_today(question: &str, today: NaiveDate) -> Option<ResolvedScheduleQuery> {
  let trimmed = question.trim();
  if trimmed.is_empty() {
    return None;
  }
  let lower = trimmed.to_lowercase();
  if lower.contains("the day after tomorrow") || lower.contains("後天") {
    let target = today.checked_add_days(chrono::Days::new(2))?;
    return Some(ResolvedScheduleQuery { target_date: target.format("%Y-%m-%d").to_string(), reason: "relative date: day after tomorrow".into() });
  }
  if lower.contains("tomorrow") || lower.contains("明天") {
    let target = today.checked_add_days(chrono::Days::new(1))?;
    return Some(ResolvedScheduleQuery { target_date: target.format("%Y-%m-%d").to_string(), reason: "relative date: tomorrow".into() });
  }
  if lower.contains("today") || lower.contains("今天") {
    return Some(ResolvedScheduleQuery { target_date: today.format("%Y-%m-%d").to_string(), reason: "relative date: today".into() });
  }

  for token in extract_day_month_tokens(trimmed) {
    let normalized = token.replace('\u{FF0F}', "/");
    let Some((day, month)) = parse_day_month(&normalized) else {
      continue;
    };
    if let Some(date) = NaiveDate::from_ymd_opt(today.year(), month, day) {
      return Some(ResolvedScheduleQuery { target_date: date.format("%Y-%m-%d").to_string(), reason: format!("explicit date: {}", normalized) });
    }
  }

  None
}

fn extract_day_month_tokens(text: &str) -> Vec<String> {
  text
    .split(|character: char| !character.is_ascii_digit() && !matches!(character, '/' | '-' | '\u{FF0F}'))
    .filter(|token| !token.is_empty())
    .map(String::from)
    .collect()
}

fn format_ask_candidate_card(card: &SavedCard) -> String {
  let due = format_due(card);
  format!(
    "id: {}\nTitle: {}\nProject: {}\nKind: {}\nStatus: {}\nDue: {}\nSummary: {}\nTags: {}\nSource chars: {}\nSource excerpt: {}",
    card.id,
    card.title,
    if card.project.is_empty() { "No project" } else { &card.project },
    card.card_kind,
    card.status,
    if due.is_empty() { "No due date" } else { &due },
    card.summary,
    card.tags.join(", "),
    card.source_text.chars().count(),
    truncate(&card.source_text, ASK_CONTEXT_SOURCE_EXCERPT_LIMIT)
  )
}

fn format_due(card: &SavedCard) -> String {
  [card.due_date.as_str(), card.due_time.as_str()].into_iter().filter(|value| !value.is_empty()).collect::<Vec<_>>().join(" ")
}

fn tokenize(value: &str) -> Vec<String> {
  value
    .to_lowercase()
    .split(|c: char| !c.is_ascii_alphanumeric() && c != '-')
    .filter(|word| word.len() >= 3 && word.chars().next().is_some_and(|c| c.is_ascii_alphabetic()))
    .map(String::from)
    .collect()
}

fn stop_words() -> HashSet<&'static str> {
  ["about", "after", "also", "and", "are", "can", "does", "from", "how", "into", "should", "that", "the", "this", "what", "when", "where", "while", "will", "with", "work"].into_iter().collect()
}

fn truncate(value: &str, max_len: usize) -> String {
  if value.len() <= max_len {
    value.into()
  } else {
    format!("{}...", value.chars().take(max_len.saturating_sub(3)).collect::<String>().trim())
  }
}

fn current_local_date() -> String {
  local_today().format("%Y-%m-%d").to_string()
}

fn local_today() -> NaiveDate {
  let now = Local::now();
  NaiveDate::from_ymd_opt(now.year(), now.month(), now.day()).expect("local date should be valid")
}

fn sample_cards() -> Vec<SavedCard> {
  let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
  vec![
    SavedCard {
      id: uuid::Uuid::new_v4().to_string(),
      title: "QVAT support case: wholesale invoice mismatch".into(),
      summary: "When a wholesale order is closed but the pending header is missing, rebuild the OS invoice source for the target invoice and rerun extraction before marking it manual.".into(),
      project: String::new(),
      card_kind: "knowledge".into(),
      status: "open".into(),
      due_date: String::new(),
      due_time: String::new(),
      tags: vec!["qvat".into(), "support-case".into(), "wholesale".into(), "invoice".into()],
      content_type: "reference".into(),
      source_text: "Support case: wholesale invoice mismatch. If order status is close, rebuild QVAT_AR_OS_INVOICE_SOURCE for the specified invoice number, run SP_EXTRACT_OS_INVOICES before deleting unfinished records, then update QVAT_AR_OS_PENDING_HEADER so DATA_SOURCE is MANUAL for that invoice. Final check: QVAT_AR_OS_PENDING_HEADER should contain the invoice.".into(),
      created_at: now.clone(),
      updated_at: now.clone(),
    },
    SavedCard {
      id: uuid::Uuid::new_v4().to_string(),
      title: "QVAT support case: RPT08 amount mismatch".into(),
      summary: "For RPT08 special invoice amount mismatches, compare grouping dates because the user may have downloaded only one grouping date.".into(),
      project: String::new(),
      card_kind: "knowledge".into(),
      status: "open".into(),
      due_date: String::new(),
      due_time: String::new(),
      tags: vec!["qvat".into(), "support-case".into(), "rpt08".into(), "invoice".into()],
      content_type: "reference".into(),
      source_text: "Support case: RPT08 amount mismatch. If special invoice amount does not match RPT08, compare the grouping dates and confirm whether the user downloaded all grouping date batches before escalating.".into(),
      created_at: now.clone(),
      updated_at: now,
    },
  ]
}

fn error_message(error: impl std::fmt::Display) -> String {
  error.to_string()
}

fn is_newer_version(available: &str, current: &str) -> bool {
  parse_semver_triplet(available) > parse_semver_triplet(current)
}

fn parse_semver_triplet(version: &str) -> (u64, u64, u64) {
  let clean = version.trim().trim_start_matches('v');
  let mut parts = clean.split('.').map(|part| part.parse::<u64>().unwrap_or(0));
  (
    parts.next().unwrap_or(0),
    parts.next().unwrap_or(0),
    parts.next().unwrap_or(0),
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn resolves_relative_schedule_dates_from_today_anchor() {
    let today = NaiveDate::from_ymd_opt(2026, 6, 3).unwrap();
    expect_schedule_date(resolve_schedule_query_with_today("所以我明天有什麼面試", today), "2026-06-04");
    expect_schedule_date(resolve_schedule_query_with_today("今天有什麼面試", today), "2026-06-03");
    expect_schedule_date(resolve_schedule_query_with_today("後天有什麼面試", today), "2026-06-05");
  }

  #[test]
  fn resolves_explicit_day_month_tokens_without_spaces() {
    let today = NaiveDate::from_ymd_opt(2026, 6, 3).unwrap();
    expect_schedule_date(resolve_schedule_query_with_today("4/6有什麼面試", today), "2026-06-04");
    expect_schedule_date(resolve_schedule_query_with_today("4／6有什麼面試", today), "2026-06-04");
    expect_schedule_date(resolve_schedule_query_with_today("4-6 有什麼面試", today), "2026-06-04");
  }

  #[test]
  fn resolves_english_schedule_queries() {
    let today = NaiveDate::from_ymd_opt(2026, 6, 3).unwrap();
    expect_schedule_date(resolve_schedule_query_with_today("What interview do I have tomorrow?", today), "2026-06-04");
    expect_schedule_date(resolve_schedule_query_with_today("What interview do I have today?", today), "2026-06-03");
    expect_schedule_date(resolve_schedule_query_with_today("What interview do I have the day after tomorrow?", today), "2026-06-05");
  }

  #[test]
  fn resolves_explicit_day_month_tokens_with_leading_zeroes() {
    let today = NaiveDate::from_ymd_opt(2026, 6, 3).unwrap();
    expect_schedule_date(resolve_schedule_query_with_today("04/06 interview", today), "2026-06-04");
    expect_schedule_date(resolve_schedule_query_with_today("04／06 interview", today), "2026-06-04");
  }

  #[test]
  fn ignores_non_schedule_queries_without_dates() {
    let today = NaiveDate::from_ymd_opt(2026, 6, 3).unwrap();
    assert!(resolve_schedule_query_with_today("Explain the Expert Systems interview Q&A document", today).is_none());
    assert!(resolve_schedule_query_with_today("Which card is the longest?", today).is_none());
  }

  #[test]
  fn prioritizes_cards_matching_the_resolved_schedule_date() {
    let cards = vec![
      scheduled_card("tradelink", "Tradelink", "2026-06-03", "11:00"),
      scheduled_card("ha", "HA interview", "2026-06-04", "09:00"),
      scheduled_card("expert", "Expert Systems", "2026-06-03", "15:30"),
    ];
    let resolved = ResolvedScheduleQuery {
      target_date: "2026-06-04".into(),
      reason: "test".into(),
    };

    let selected = select_relevant_cards("What interview do I have tomorrow?", &cards, 4, Some(&resolved));

    assert_eq!(selected.first().map(|card| card.id.as_str()), Some("ha"));
    assert!(selected.iter().any(|card| card.id == "tradelink"));
    assert!(selected.iter().any(|card| card.id == "expert"));
  }

  fn expect_schedule_date(resolved: Option<ResolvedScheduleQuery>, expected: &str) {
    assert_eq!(resolved.map(|value| value.target_date), Some(expected.to_string()));
  }

  fn scheduled_card(id: &str, title: &str, due_date: &str, due_time: &str) -> SavedCard {
    SavedCard {
      id: id.into(),
      title: title.into(),
      summary: format!("{} summary", title),
      project: String::new(),
      card_kind: "event".into(),
      status: "open".into(),
      due_date: due_date.into(),
      due_time: due_time.into(),
      tags: vec!["interview".into()],
      content_type: "reference".into(),
      source_text: format!("{} source", title),
      created_at: "2026-06-01T00:00:00.000Z".into(),
      updated_at: "2026-06-01T00:00:00.000Z".into(),
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .manage(AppState {
      sync_task: Arc::new(Mutex::new(None)),
      ask_context: Arc::new(Mutex::new(AskContextState::default())),
      http: Client::new(),
    })
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      let app_handle = app.handle().clone();
      let state = app.state::<AppState>().inner().clone();
      tauri::async_runtime::spawn(async move {
        queue_cloudflare_auto_sync(&app_handle, &state, "startup".into()).await;
      });
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      ai_search_cards,
      ask,
      ask_stream,
      check_for_updates,
      clear_ask_context,
      delete_card,
      download_update,
      generate_draft,
      get_app_info,
      get_diagnostics,
      get_settings,
      get_update_state,
      install_update,
      list_cards,
      open_external,
      save_card,
      save_settings,
      seed_samples,
      sync_cloudflare_now,
      test_cloudflare_sync_connection,
      update_card_status
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
