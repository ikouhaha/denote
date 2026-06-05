import type { AppView, DenoteLanguage } from "../types.js";

type Messages = {
  appSubtitle: string;
  sidebarAskContext: string;
  workspace: string;
  ready: string;
  readyToCheckUpdates: string;
  updateAvailable(version: string): string;
  checkGithubReleases: string;
  openRelease: string;
  restart: string;
  working: string;
  settingsSaved: string;
  language: string;
  languageEnglish: string;
  languageTraditionalChinese: string;
  cloudAccount: string;
  cloudAccountHint: string;
  saveSettings: string;
  licenseKey: string;
  autoSync: string;
  lastSync: string;
  testCloud: string;
  syncNow: string;
  cloudSyncDisclosure: string;
  diagnostics: string;
  diagnosticsLoading: string;
  licenseRequired: string;
  cloudConnected(cardCount: number): string;
  cloudSynced(cardCount: number): string;
  secretCopied(label: string): string;
  secretEmpty(label: string): string;
  secretCopyFailed(label: string): string;
  hideSecret: string;
  showSecret: string;
  copySecret: string;
  loadingWorkspace: string;
  checkingUpdates: string;
  viewTitles: Record<AppView, string>;
  addCaptureTitle: string;
  addCaptureHint: string;
  generateCard: string;
  capturePlaceholder: string;
  knowledgeCardTitle: string;
  knowledgeCardHint: string;
  cancel: string;
  saveCard: string;
  draftReady: string;
  cardSaved: string;
  editingCard: string;
  editCancelled: string;
  cardAlreadyRemoved: string;
  cardMarkedDone: string;
  cardRestored: string;
  deleteConfirm(title: string): string;
  cardMovedToTrash: string;
  askQuestionRequired: string;
  askReadingSavedKnowledge: string;
  askStartingStream: string;
  askResponding: string;
  askFailed: string;
  askAnswered: string;
  askCleared: string;
  askClearing: string;
  aiSearchRunning: string;
  aiSearchFound(count: number): string;
  librarySearchRequired: string;
  libraryTitle: string;
  noCardsYet: string;
  askTitle: string;
  askHint: string;
  clear: string;
  noConversationYet: string;
  askAfterSave: string;
  askPlaceholder: string;
  send: string;
  you: string;
  denote: string;
  calendarTitle: string;
  calendarNoCards: string;
  calendarScheduled(count: number): string;
  today: string;
  tomorrow: string;
  upcoming: string;
  noDate: string;
  edit: string;
  editCard: string;
  done: string;
  restore: string;
  delete: string;
  deleted: string;
  active: string;
  all: string;
  knowledge: string;
  task: string;
  event: string;
  reminder: string;
  schedule: string;
  trash: string;
  searchCardsPlaceholder: string;
  aiSearch: string;
  recent: string;
  localRanked: string;
  aiRanked: string;
  cardCountSummary(filtered: number, total: number, mode: string): string;
  noProject: string;
  projectPlaceholder: string;
  tagsPlaceholder: string;
  title: string;
  summary: string;
  project: string;
  cardKind: string;
  contentType: string;
  status: string;
  dueDate: string;
  dueTime: string;
  tags: string;
  sourceText: string;
  technicalNote: string;
  projectNote: string;
  reference: string;
  personalNote: string;
  capturedQa: string;
  other: string;
  open: string;
  archived: string;
};

const messages: Record<DenoteLanguage, Messages> = {
  en: {
    appSubtitle: "Local AI knowledge",
    sidebarAskContext: "Local cards provide context for Ask.",
    workspace: "Workspace",
    ready: "Ready",
    readyToCheckUpdates: "Ready to check for updates",
    updateAvailable: (version) => `v${version} available`,
    checkGithubReleases: "Check GitHub Releases for updates",
    openRelease: "Open release",
    restart: "Restart",
    working: "Working",
    settingsSaved: "Settings saved",
    language: "Language",
    languageEnglish: "English",
    languageTraditionalChinese: "Traditional Chinese",
    cloudAccount: "Cloud account",
    cloudAccountHint: "License key is required. The app loads remote AI provider settings from your Cloudflare license.",
    saveSettings: "Save Settings",
    licenseKey: "License key",
    autoSync: "Auto sync",
    lastSync: "Last sync",
    testCloud: "Test Cloud",
    syncNow: "Sync Now",
    cloudSyncDisclosure: "Cloud sync is handled by the app. Cards sync through cloud storage, and AI provider settings come from the license record.",
    diagnostics: "Diagnostics",
    diagnosticsLoading: "Loading diagnostic paths...",
    licenseRequired: "Cloudflare license key is required",
    cloudConnected: (cardCount) => `Cloudflare connected: ${cardCount} cards`,
    cloudSynced: (cardCount) => `Cloudflare synced: ${cardCount} cards`,
    secretCopied: (label) => `${label} copied`,
    secretEmpty: (label) => `${label} is empty`,
    secretCopyFailed: (label) => `Could not copy ${label.toLowerCase()}`,
    hideSecret: "Hide secret",
    showSecret: "Show secret",
    copySecret: "Copy secret",
    loadingWorkspace: "Loading workspace",
    checkingUpdates: "Checking updates",
    viewTitles: {
      add: "Add knowledge",
      library: "Library",
      calendar: "Calendar",
      ask: "Ask",
      settings: "Settings"
    },
    addCaptureTitle: "Capture text",
    addCaptureHint: "Paste a useful note, then generate an editable card.",
    generateCard: "Generate Card",
    capturePlaceholder: "Paste knowledge here...",
    knowledgeCardTitle: "Knowledge Card",
    knowledgeCardHint: "Review before it enters your local library.",
    cancel: "Cancel",
    saveCard: "Save Card",
    draftReady: "Draft ready",
    cardSaved: "Card saved; sync queued if enabled",
    editingCard: "Editing card",
    editCancelled: "Edit cancelled",
    cardAlreadyRemoved: "Card already removed",
    cardMarkedDone: "Card marked done; sync queued if enabled",
    cardRestored: "Card restored; sync queued if enabled",
    deleteConfirm: (title) => `Move "${title}" to Trash?`,
    cardMovedToTrash: "Card moved to Trash; sync queued if enabled",
    askQuestionRequired: "Question is required",
    askReadingSavedKnowledge: "Reading saved knowledge",
    askStartingStream: "Starting LLM stream",
    askResponding: "LLM is responding",
    askFailed: "LLM request failed",
    askAnswered: "Answered by LLM",
    askCleared: "Ask cleared",
    askClearing: "Clearing Ask",
    aiSearchRunning: "Running AI search",
    aiSearchFound: (count) => `AI Search found ${count} cards`,
    librarySearchRequired: "Search query is required",
    libraryTitle: "Library",
    noCardsYet: "No cards yet. Save a card from Add to build your own library.",
    askTitle: "Ask saved knowledge",
    askHint: "LLM answers using saved local cards as context.",
    clear: "Clear",
    noConversationYet: "No conversation yet.",
    askAfterSave: "Ask after you save cards to your local library.",
    askPlaceholder: "Ask your saved knowledge...",
    send: "Send",
    you: "You",
    denote: "Denote",
    calendarTitle: "Calendar",
    calendarNoCards: "No cards",
    calendarScheduled: (count) => `${count} scheduled ${count === 1 ? "card" : "cards"}`,
    today: "Today",
    tomorrow: "Tomorrow",
    upcoming: "Upcoming",
    noDate: "No date",
    edit: "Edit",
    editCard: "Edit card",
    done: "Done",
    restore: "Restore",
    delete: "Delete",
    deleted: "Deleted",
    active: "Active",
    all: "All",
    knowledge: "Knowledge",
    task: "Task",
    event: "Event",
    reminder: "Reminder",
    schedule: "Schedule",
    trash: "Trash",
    searchCardsPlaceholder: "Search cards...",
    aiSearch: "AI Search",
    recent: "Recent",
    localRanked: "Local ranked",
    aiRanked: "AI ranked",
    cardCountSummary: (filtered, total, mode) => `${filtered} of ${total} cards | ${mode}`,
    noProject: "No project",
    projectPlaceholder: "QVAT, Vendor DB, Personal...",
    tagsPlaceholder: "rag, sqlite, vendor",
    title: "Title",
    summary: "Summary",
    project: "Project",
    cardKind: "Card kind",
    contentType: "Content type",
    status: "Status",
    dueDate: "Due date",
    dueTime: "Due time",
    tags: "Tags",
    sourceText: "Source text",
    technicalNote: "Technical note",
    projectNote: "Project note",
    reference: "Reference",
    personalNote: "Personal note",
    capturedQa: "Captured Q&A",
    other: "Other",
    open: "Open",
    archived: "Archived"
  },
  "zh-Hant": {
    appSubtitle: "本地 AI 知識庫",
    sidebarAskContext: "Ask 會使用本地卡片作為上下文。",
    workspace: "工作區",
    ready: "就緒",
    readyToCheckUpdates: "可檢查更新",
    updateAvailable: (version) => `可更新至 v${version}`,
    checkGithubReleases: "到 GitHub Releases 檢查更新",
    openRelease: "打開版本頁",
    restart: "重新啟動",
    working: "處理中",
    settingsSaved: "設定已儲存",
    language: "語言",
    languageEnglish: "English",
    languageTraditionalChinese: "繁體中文",
    cloudAccount: "雲端帳戶",
    cloudAccountHint: "必須提供 License key。App 會透過你的 Cloudflare license 載入遠端 AI provider 設定。",
    saveSettings: "儲存設定",
    licenseKey: "License key",
    autoSync: "自動同步",
    lastSync: "上次同步",
    testCloud: "測試雲端",
    syncNow: "立即同步",
    cloudSyncDisclosure: "雲端同步由 App 處理。卡片會透過雲端儲存同步，而 AI provider 設定會從 license 記錄載入。",
    diagnostics: "診斷資訊",
    diagnosticsLoading: "正在載入診斷路徑...",
    licenseRequired: "必須提供 Cloudflare license key",
    cloudConnected: (cardCount) => `Cloudflare 已連接：${cardCount} 張卡`,
    cloudSynced: (cardCount) => `Cloudflare 已同步：${cardCount} 張卡`,
    secretCopied: (label) => `${label} 已複製`,
    secretEmpty: (label) => `${label} 為空`,
    secretCopyFailed: (label) => `無法複製${label.toLowerCase()}`,
    hideSecret: "隱藏",
    showSecret: "顯示",
    copySecret: "複製",
    loadingWorkspace: "正在載入工作區",
    checkingUpdates: "正在檢查更新",
    viewTitles: {
      add: "新增知識",
      library: "資料庫",
      calendar: "日曆",
      ask: "Ask",
      settings: "設定"
    },
    addCaptureTitle: "擷取內容",
    addCaptureHint: "貼上有用的內容，再生成可編輯卡片。",
    generateCard: "生成卡片",
    capturePlaceholder: "在這裏貼上知識內容...",
    knowledgeCardTitle: "知識卡片",
    knowledgeCardHint: "確認後才會加入本地資料庫。",
    cancel: "取消",
    saveCard: "儲存卡片",
    draftReady: "草稿已準備好",
    cardSaved: "卡片已儲存；如已啟用會排入同步",
    editingCard: "正在編輯卡片",
    editCancelled: "已取消編輯",
    cardAlreadyRemoved: "卡片已不存在",
    cardMarkedDone: "卡片已標記完成；如已啟用會排入同步",
    cardRestored: "卡片已還原；如已啟用會排入同步",
    deleteConfirm: (title) => `將「${title}」移到垃圾桶？`,
    cardMovedToTrash: "卡片已移到垃圾桶；如已啟用會排入同步",
    askQuestionRequired: "必須輸入問題",
    askReadingSavedKnowledge: "正在讀取已儲存知識",
    askStartingStream: "正在啟動 LLM 串流",
    askResponding: "LLM 正在回應",
    askFailed: "LLM 請求失敗",
    askAnswered: "LLM 已回應",
    askCleared: "Ask 已清除",
    askClearing: "正在清除 Ask",
    aiSearchRunning: "正在執行 AI 搜尋",
    aiSearchFound: (count) => `AI 搜尋找到 ${count} 張卡`,
    librarySearchRequired: "必須輸入搜尋內容",
    libraryTitle: "資料庫",
    noCardsYet: "暫時沒有卡片。先到新增頁儲存卡片來建立你的資料庫。",
    askTitle: "詢問已儲存知識",
    askHint: "LLM 會使用本地已儲存卡片作為上下文。",
    clear: "清除",
    noConversationYet: "暫時沒有對話。",
    askAfterSave: "先儲存卡片，再用 Ask 發問。",
    askPlaceholder: "詢問你的已儲存知識...",
    send: "送出",
    you: "你",
    denote: "Denote",
    calendarTitle: "日曆",
    calendarNoCards: "沒有卡片",
    calendarScheduled: (count) => `${count} 張已排程卡片`,
    today: "今天",
    tomorrow: "明天",
    upcoming: "之後",
    noDate: "未設日期",
    edit: "編輯",
    editCard: "編輯卡片",
    done: "完成",
    restore: "還原",
    delete: "刪除",
    deleted: "已刪除",
    active: "進行中",
    all: "全部",
    knowledge: "知識",
    task: "任務",
    event: "事件",
    reminder: "提醒",
    schedule: "排程",
    trash: "垃圾桶",
    searchCardsPlaceholder: "搜尋卡片...",
    aiSearch: "AI 搜尋",
    recent: "最近",
    localRanked: "本地排序",
    aiRanked: "AI 排序",
    cardCountSummary: (filtered, total, mode) => `${filtered} / ${total} 張卡 | ${mode}`,
    noProject: "未分類專案",
    projectPlaceholder: "QVAT、Vendor DB、Personal...",
    tagsPlaceholder: "rag, sqlite, vendor",
    title: "標題",
    summary: "摘要",
    project: "專案",
    cardKind: "卡片類型",
    contentType: "內容類型",
    status: "狀態",
    dueDate: "日期",
    dueTime: "時間",
    tags: "標籤",
    sourceText: "來源內容",
    technicalNote: "技術筆記",
    projectNote: "專案筆記",
    reference: "參考資料",
    personalNote: "個人筆記",
    capturedQa: "擷取問答",
    other: "其他",
    open: "進行中",
    archived: "封存"
  }
};

export function getMessages(language: DenoteLanguage): Messages {
  return messages[language] || messages.en;
}
