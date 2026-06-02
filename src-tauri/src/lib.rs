use chrono::{Datelike, Local, NaiveDate, Utc};
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

#[derive(Clone)]
struct AppState {
  sync_task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
  http: Client,
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
struct ChatMessage {
  role: String,
  content: String,
}

#[derive(Debug, Serialize)]
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

#[derive(Debug, Deserialize, Serialize)]
struct LlmMessage {
  role: String,
  content: String,
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
      LlmMessage {
        role: "system".into(),
        content: "You convert messy notes into a Denote card. Return only JSON with fields: title, summary, project, card_kind, status, due_date, due_time, tags, content_type. Do not return source_text; the app preserves the pasted source locally. card_kind must be one of knowledge, task, event, reminder. status must be open unless the source says it is done. due_date must be YYYY-MM-DD when the text contains a date or relative date; use the current date context from the user message to resolve words like tomorrow. due_time must be HH:MM 24-hour time or empty. content_type must be one of technical_note, project_note, reference, personal_note, captured_qa, other. tags must be an array of short lowercase strings.".into(),
      },
      LlmMessage {
        role: "user".into(),
        content: format!("Current date: {}\n\nSource text:\n{}", current_local_date(), source),
      },
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
async fn ask(app: AppHandle, state: tauri::State<'_, AppState>, payload: AskPayload) -> Result<AskAnswer, String> {
  let mut parts: Vec<String> = payload
    .history
    .unwrap_or_default()
    .into_iter()
    .filter(|message| message.role == "user")
    .rev()
    .take(3)
    .map(|message| message.content)
    .collect();
  parts.reverse();
  parts.push(payload.question);
  let question = require_text(parts.join("\n").trim(), "Question")?.to_string();
  let settings = resolve_provider_settings(&app, &state.http).await?;
  let cards: Vec<SavedCard> = read_store(&app)
    .await?
    .cards
    .into_iter()
    .filter(|card| normalize_card_status(&card.status) != "deleted")
    .collect();
  let context_cards = select_context_cards(&question, &cards);
  let context_text = if context_cards.is_empty() {
    "No saved cards matched. Answer normally, and say clearly when the saved library has no supporting evidence.".into()
  } else {
    context_cards.iter().map(format_context_card).collect::<Vec<_>>().join("\n\n---\n\n")
  };
  let text = call_chat_completion(
    &app,
    &state.http,
    &settings,
    vec![
      LlmMessage {
        role: "system".into(),
        content: "You are Denote, an LLM knowledge assistant. Answer the user directly in concise Markdown. Use headings, bullet lists, tables, blockquotes, inline code, or fenced code blocks when they improve clarity. Use saved card context when relevant, cite card titles in the answer, and be explicit when the saved library does not contain enough evidence. Do not invent database facts not present in the provided context.".into(),
      },
      LlmMessage {
        role: "user".into(),
        content: format!("Current date: {}\n\nQuestion:\n{}\n\nSaved card context:\n{}", current_local_date(), question, context_text),
      },
    ],
  )
  .await?;
  Ok(AskAnswer {
    text,
    sources: context_cards
      .iter()
      .map(|card| AskSource {
        card_id: card.id.clone(),
        title: card.title.clone(),
        excerpt: truncate(&card.source_text, 360),
      })
      .collect(),
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
  let separator = if value.contains('/') { '/' } else if value.contains('-') { '-' } else { return None };
  let mut parts = value.split(separator);
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

fn select_context_cards(question: &str, cards: &[SavedCard]) -> Vec<SavedCard> {
  let terms: Vec<String> = tokenize(question).into_iter().filter(|term| !stop_words().contains(term.as_str())).collect();
  let mut selected = Vec::new();
  if is_schedule_question(question) {
    let mut schedule: Vec<SavedCard> = cards.iter().filter(|card| matches!(card.card_kind.as_str(), "task" | "event" | "reminder")).cloned().collect();
    schedule.sort_by(|a, b| format_due(a).cmp(&format_due(b)).then(b.updated_at.cmp(&a.updated_at)));
    selected.extend(schedule.into_iter().take(8));
  }
  let mut ranked: Vec<(SavedCard, usize)> = cards.iter().cloned().map(|card| {
    let haystack = format!("{} {} {} {} {}", card.title, card.summary, card.project, card.tags.join(" "), card.source_text).to_lowercase();
    let score = terms.iter().filter(|term| haystack.contains(term.as_str())).count();
    (card, score)
  }).collect();
  ranked.sort_by(|a, b| b.1.cmp(&a.1).then(b.0.updated_at.cmp(&a.0.updated_at)));
  selected.extend(ranked.into_iter().filter(|(_, score)| *score > 0).take(8).map(|(card, _)| card));
  if selected.is_empty() {
    selected.extend(cards.iter().take(6).cloned());
  }
  dedupe_cards(selected).into_iter().take(10).collect()
}

fn dedupe_cards(cards: Vec<SavedCard>) -> Vec<SavedCard> {
  let mut seen = HashSet::new();
  cards.into_iter().filter(|card| seen.insert(card.id.clone())).collect()
}

fn is_schedule_question(question: &str) -> bool {
  let lower = question.to_lowercase();
  ["today", "tomorrow", "upcoming", "schedule", "calendar", "due", "task", "event", "reminder", "日程", "行程", "待辦", "任务", "任務", "今天", "明天", "後天", "下周", "下週"]
    .iter()
    .any(|term| lower.contains(term))
}

fn format_context_card(card: &SavedCard) -> String {
  let due = format_due(card);
  format!(
    "Title: {}\nProject: {}\nKind: {}\nStatus: {}\nDue: {}\nSummary: {}\nTags: {}\nSource:\n{}",
    card.title,
    if card.project.is_empty() { "No project" } else { &card.project },
    card.card_kind,
    card.status,
    if due.is_empty() { "No due date" } else { &due },
    card.summary,
    card.tags.join(", "),
    truncate(&card.source_text, 1600)
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
  let now = Local::now();
  format!("{:04}-{:02}-{:02}", now.year(), now.month(), now.day())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .manage(AppState {
      sync_task: Arc::new(Mutex::new(None)),
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
      ask,
      check_for_updates,
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
