export type SyncProvider = "local" | "cloudflare";
export type AppView = "add" | "library" | "calendar" | "ask" | "settings";

export type DenoteCard = {
  id: string;
  title: string;
  summary: string;
  project: string;
  card_kind: "knowledge" | "task" | "event" | "reminder";
  status: "open" | "done" | "archived" | "deleted";
  due_date: string;
  due_time: string;
  tags: string[];
  content_type: string;
  source_text: string;
  created_at?: string;
  updated_at: string;
};

export type CloudflareSyncSettings = {
  endpoint: string;
  licenseKey: string;
  autoSyncEnabled: boolean;
  lastSyncedAt: string;
};

export type DenoteSettings = {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  syncProvider: SyncProvider;
  cloudflare: CloudflareSyncSettings;
  taskProvider: "local";
};

export type Diagnostics = {
  userDataPath: string;
  logFilePath: string;
  cardsFilePath: string;
  settingsFilePath: string;
};

export type UpdateState = {
  status: string;
  currentVersion?: string;
  availableVersion?: string;
  releaseUrl?: string;
  progress?: number | null;
  message?: string;
};

export type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: Array<{ title: string; excerpt: string }>;
  streaming?: boolean;
};

export type AskStreamDelta = {
  streamId: string;
  delta: string;
};

export type AskStreamDone = {
  streamId: string;
  sources: ChatMessage["sources"];
};

export type AskStreamError = {
  streamId: string;
  message: string;
};

export type AskStreamProgress = {
  streamId: string;
  message: string;
};

export type DenoteApi = {
  generateDraft(sourceText: string): Promise<DenoteCard>;
  saveCard(card: Partial<DenoteCard>): Promise<DenoteCard>;
  deleteCard(id: string): Promise<{ deleted: boolean }>;
  updateCardStatus(payload: { id: string; status: string }): Promise<{ updated: boolean; card?: DenoteCard }>;
  getAppInfo(): Promise<{ version: string }>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<UpdateState>;
  openExternal(url: string): Promise<{ opened: boolean }>;
  onUpdateStateChanged(callback: (updateState: UpdateState) => void): () => void;
  onCardsChanged(callback: (payload: { reason: string }) => void): () => void;
  onAskDelta(callback: (payload: AskStreamDelta) => void): () => void;
  onAskDone(callback: (payload: AskStreamDone) => void): () => void;
  onAskError(callback: (payload: AskStreamError) => void): () => void;
  onAskProgress(callback: (payload: AskStreamProgress) => void): () => void;
  listCards(): Promise<DenoteCard[]>;
  aiSearchCards(payload: { query: string; filter: string; limit?: number }): Promise<{ cards: DenoteCard[] }>;
  ask(payload: { question: string; history: ChatMessage[] }): Promise<{ text: string; sources: ChatMessage["sources"] }>;
  askStream(payload: { streamId: string; question: string; history: ChatMessage[] }): Promise<{ streamId: string }>;
  clearAskContext(): Promise<void>;
  getSettings(): Promise<DenoteSettings>;
  getDiagnostics(): Promise<Diagnostics>;
  saveSettings(settings: Partial<DenoteSettings>): Promise<DenoteSettings>;
  testCloudflareSyncConnection(settings?: Partial<CloudflareSyncSettings>): Promise<{ connected: boolean; cardCount: number; updatedAt: string }>;
  syncCloudflareNow(settings?: Partial<CloudflareSyncSettings>): Promise<{ synced: boolean; cardCount: number; updatedAt: string }>;
  seedSamples(): Promise<{ added: number; cards: DenoteCard[] }>;
};

declare global {
  interface Window {
    denote: DenoteApi;
  }
}
