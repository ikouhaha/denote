export type TaskProvider = "local" | "notion";
export type SyncProvider = "local" | "sftp";
export type LocalView = "add" | "library" | "calendar" | "ask";
export type NotionView = "notionTasks" | "notionAddTask";
export type NotionAskView = "notionAsk";
export type SharedView = "settings";
export type AppView = LocalView | NotionView | NotionAskView | SharedView;

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

export type DenoteNotionTask = {
  id: string;
  provider: "notion";
  sourceId: string;
  sourceName: string;
  title: string;
  status: string;
  priority: string;
  taskType: string;
  assignees: Array<{ id: string; name: string }>;
  dueDate: string;
  taskReceiveDate: string;
  projectIds: string[];
  projectNames: string[];
  sprintIds: string[];
  sprintNames: string[];
  number: number | null;
  notionId: string;
  url: string;
  updated_at: string;
};

export type EntityOption = {
  id: string;
  name: string;
  title?: string;
  enabled?: boolean;
  token?: string;
  taskSources?: NotionTaskSource[];
};

export type NotionTaskSource = {
  id: string;
  name: string;
  enabled: boolean;
  url?: string;
};

export type NotionTokenProfile = {
  id: string;
  name: string;
  token: string;
  taskSources: NotionTaskSource[];
};

export type SftpSettings = {
  host: string;
  port: number;
  username: string;
  password: string;
  privateKeyPath: string;
  passphrase: string;
  rootPath: string;
  notesPath: string;
};

export type NotionMetadata = {
  provider: "notion";
  tokenProfileId: string;
  tokenProfileName: string;
  statusOptions: string[];
  priorityOptions: string[];
  taskTypeOptions: string[];
  taskSources: NotionTaskSource[];
  projects: EntityOption[];
  sprints: EntityOption[];
  users: EntityOption[];
};

export type NotionTaskDetail = {
  task: DenoteNotionTask;
  blocks: Array<{ id: string; type: string; text: string; hasChildren: boolean }>;
  comments: Array<{ id: string; createdTime: string; text: string }>;
  bodyText: string;
  commentText: string;
  loadedAt: string;
};

export type NotionActionPlan = {
  answer: string;
  actions: Array<{
    type: "update_task_properties" | "append_task_note" | "archive_task";
    taskId: string;
    properties?: Record<string, unknown>;
    note?: string;
    reason?: string;
  }>;
  needsConfirmation: boolean;
};

export type DenoteSettings = {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  syncProvider: SyncProvider;
  sftp: SftpSettings;
  taskProvider: TaskProvider;
  notionToken: string;
  notionTasksDatabaseId: string;
  notionTaskSources: NotionTaskSource[];
  activeNotionTokenId: string;
  notionTokens: NotionTokenProfile[];
  notionWorkspaces?: NotionTokenProfile[];
  activeNotionWorkspaceId?: string;
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
  progress?: number | null;
  message?: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  sources?: Array<{ title: string; excerpt: string }>;
  streaming?: boolean;
};

export type DenoteApi = {
  generateDraft(sourceText: string): Promise<DenoteCard>;
  refineDraft(payload: { sourceText: string; currentDraft: Partial<DenoteCard>; instruction: string }): Promise<DenoteCard>;
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
  setTaskProvider(provider: TaskProvider): Promise<TaskProvider>;
  getTaskProviderMetadata(): Promise<NotionMetadata | { provider: "local" }>;
  discoverNotionDatabases(input?: { notionToken?: string }): Promise<NotionTaskSource[]>;
  listTasks(input?: { includeCompleted?: boolean; forceRefresh?: boolean }): Promise<DenoteNotionTask[]>;
  syncNotionTasks(input?: { includeCompleted?: boolean }): Promise<{ syncedAt: string; tasks: DenoteNotionTask[] }>;
  createTask(task: Record<string, unknown>): Promise<DenoteNotionTask>;
  updateTaskStatus(payload: { id: string; status: string }): Promise<{ updated: boolean; card?: DenoteNotionTask }>;
  generateNotionTaskDraft(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  getNotionTaskDetail(payload: { taskId: string; updated_at?: string; forceRefresh?: boolean }): Promise<NotionTaskDetail>;
  askNotion(payload: Record<string, unknown>): Promise<{ text: string; sources: ChatMessage["sources"]; actionPlan?: NotionActionPlan }>;
  applyNotionAction(payload: { plan: NotionActionPlan }): Promise<{ applied: boolean; results: Array<Record<string, unknown>> }>;
  archiveNotionTask(payload: { taskId: string }): Promise<{ archived: boolean; taskId: string }>;
  listCards(): Promise<DenoteCard[]>;
  ask(payload: { question: string; history: ChatMessage[] }): Promise<{ text: string; sources: ChatMessage["sources"] }>;
  getSettings(): Promise<DenoteSettings>;
  getDiagnostics(): Promise<Diagnostics>;
  saveSettings(settings: Partial<DenoteSettings>): Promise<DenoteSettings>;
  testSftpConnection(settings?: Partial<SftpSettings>): Promise<{ connected: boolean; rootPath: string; notesPath: string }>;
  seedSamples(): Promise<{ added: number; cards: DenoteCard[] }>;
};

declare global {
  interface Window {
    denote: DenoteApi;
  }
}
