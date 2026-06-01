import { FormEvent, useEffect, useMemo, useState } from "react";
import { Combobox } from "../components/Combobox.js";
import { MarkdownMessage } from "../components/MarkdownMessage.js";
import { revealAssistantMessage } from "../lib/chatReveal.js";
import { formatNotionTaskMeta, formatProjectLabel, formatSourceLabel, formatSprintLabel, isDeletedStatus, isDoneStatus, uniqueSorted } from "../lib/format.js";
import { getActiveNotionToken } from "../lib/settings.js";
import type { AppView, ChatMessage, DenoteNotionTask, DenoteSettings, EntityOption, NotionActionPlan, NotionMetadata, NotionTaskSource } from "../types.js";

type Props = {
  view: AppView;
  settings: DenoteSettings | null;
  setSettings(settings: DenoteSettings): void;
  setView(view: AppView): void;
  refreshSettings(): Promise<DenoteSettings>;
  runAction(label: string, action: () => Promise<void>): Promise<void>;
  setStatus(message: string): void;
};

type NotionTaskDraft = {
  title: string;
  description: string;
  status: string;
  priority: string;
  taskType: string;
  sourceId: string;
  assigneeIds: string[];
  dueDate: string;
  taskReceiveDate: string;
  projectId: string;
  sprintId: string;
};

type Filters = {
  status: string;
  project: string;
  assignee: string;
  source: string;
  query: string;
};

const emptyDraft: NotionTaskDraft = {
  title: "",
  description: "",
  status: "",
  priority: "",
  taskType: "",
  sourceId: "",
  assigneeIds: [],
  dueDate: "",
  taskReceiveDate: "",
  projectId: "",
  sprintId: ""
};

export function NotionWorkspace({ view, settings, setSettings, setView, refreshSettings, runAction, setStatus }: Props) {
  const [tasks, setTasks] = useState<DenoteNotionTask[]>([]);
  const [metadata, setMetadata] = useState<NotionMetadata | null>(null);
  const [integrationError, setIntegrationError] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [draftInstruction, setDraftInstruction] = useState("");
  const [draft, setDraft] = useState<NotionTaskDraft>(emptyDraft);
  const [filters, setFilters] = useState<Filters>({ status: "", project: "", assignee: "", source: "", query: "" });
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [asking, setAsking] = useState(false);
  const [pendingActionPlan, setPendingActionPlan] = useState<NotionActionPlan | null>(null);
  const [detailPreview, setDetailPreview] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState("");

  const activeToken = settings ? getActiveNotionToken(settings.notionTokens || [], settings.activeNotionTokenId) : null;
  const enabledSources = activeToken?.taskSources.filter((source) => source.enabled) || [];
  const filteredTasks = useMemo(() => applyNotionFilters(tasks, filters), [tasks, filters]);

  useEffect(() => {
    void loadNotionWorkspace();
  }, [settings?.activeNotionTokenId, settings?.taskProvider, includeCompleted]);

  useEffect(() => {
    if (!settings || settings.taskProvider !== "notion" || !activeToken || enabledSources.length === 0) {
      return;
    }
    const timer = window.setInterval(() => {
      void syncTasks(false);
    }, 60000);
    return () => window.clearInterval(timer);
  }, [settings?.activeNotionTokenId, settings?.taskProvider, includeCompleted, activeToken?.id, enabledSources.length]);

  async function loadNotionWorkspace() {
    if (!settings || settings.taskProvider !== "notion") {
      return;
    }
    if (!activeToken || enabledSources.length === 0) {
      setMetadata(null);
      setTasks([]);
      setIntegrationError("");
      return;
    }
    await runAction("Loading Notion tasks", async () => {
      try {
        const loadedMetadata = await window.denote.getTaskProviderMetadata();
        if (loadedMetadata.provider !== "notion") {
          return;
        }
        setMetadata(loadedMetadata);
        setDraftDefaults(loadedMetadata);
        const loadedTasks = await window.denote.listTasks({ includeCompleted });
        setTasks(loadedTasks);
        setLastSyncedAt(new Date().toLocaleTimeString());
        setIntegrationError("");
        setStatus(`${loadedTasks.length} Notion tasks loaded`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setIntegrationError(message);
        setTasks([]);
        setStatus(message);
      }
    });
  }

  function setDraftDefaults(loadedMetadata: NotionMetadata) {
    setDraft((current) => ({
      ...current,
      sourceId: current.sourceId || loadedMetadata.taskSources[0]?.id || "",
      status: current.status || loadedMetadata.statusOptions[0] || "",
      priority: current.priority || loadedMetadata.priorityOptions[0] || "",
      taskType: current.taskType || loadedMetadata.taskTypeOptions[0] || ""
    }));
  }

  async function syncTasks(showStatus = true) {
    if (!settings || settings.taskProvider !== "notion") {
      return;
    }
    const action = async () => {
      const result = await window.denote.syncNotionTasks({ includeCompleted });
      setTasks(result.tasks);
      setLastSyncedAt(new Date(result.syncedAt).toLocaleTimeString());
      setStatus(`${result.tasks.length} Notion tasks synced`);
    };
    if (showStatus) {
      await runAction("Syncing Notion tasks", action);
    } else {
      try {
        await action();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function generateDraft() {
    if (!sourceText.trim()) {
      setStatus("Source text is required");
      return;
    }
    await runAction("Generating Notion task with LLM", async () => {
      const nextDraft = await window.denote.generateNotionTaskDraft({ sourceText, metadata });
      setDraft({ ...emptyDraft, ...nextDraft } as NotionTaskDraft);
      setStatus("Notion task draft ready");
    });
  }

  async function refineCurrentDraft() {
    if (!draftInstruction.trim()) {
      setStatus("Tell AI what to change in the draft");
      return;
    }
    await runAction("Updating Notion draft with LLM", async () => {
      const nextDraft = await window.denote.generateNotionTaskDraft({
        sourceText: [sourceText, `Current draft:\n${JSON.stringify(draft)}`, `Instruction:\n${draftInstruction}`].filter(Boolean).join("\n\n"),
        metadata
      });
      setDraft({ ...draft, ...nextDraft } as NotionTaskDraft);
      setDraftInstruction("");
      setStatus("Notion task draft updated");
    });
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    await runAction("Saving task to Notion", async () => {
      const saved = await window.denote.createTask(draft);
      setDraft({
        ...emptyDraft,
        sourceId: draft.sourceId,
        status: draft.status,
        priority: draft.priority,
        taskType: draft.taskType
      });
      setSourceText("");
      setDraftInstruction("");
      setTasks((current) => [saved, ...current.filter((task) => task.id !== saved.id)]);
      setView("notionTasks");
      setStatus("Task saved to Notion");
    });
  }

  async function updateTaskStatus(task: DenoteNotionTask, status: string) {
    await runAction("Updating Notion task", async () => {
      const result = await window.denote.updateTaskStatus({ id: task.id, status });
      if (!result.updated) {
        setStatus("Task already removed");
        return;
      }
      await syncTasks(false);
      setStatus(isDoneStatus(status) ? "Task marked done" : "Task updated");
    });
  }

  async function archiveTask(task: DenoteNotionTask) {
    if (!window.confirm(`Archive "${task.title}" in Notion?`)) {
      return;
    }
    await runAction("Archiving Notion task", async () => {
      await window.denote.archiveNotionTask({ taskId: task.id });
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setStatus("Task archived in Notion");
    });
  }

  async function openNotionTask(task: DenoteNotionTask) {
    if (!task.url) {
      return;
    }
    await window.denote.openExternal(task.url);
  }

  async function previewTaskDetail(task: DenoteNotionTask) {
    await runAction("Loading Notion task detail", async () => {
      const detail = await window.denote.getNotionTaskDetail({ taskId: task.id, updated_at: task.updated_at });
      const body = [detail.bodyText, detail.commentText].filter(Boolean).join("\n\n");
      setDetailPreview(body || "No body blocks or comments returned for this task.");
      setView("notionAsk");
      setStatus("Notion task detail loaded");
    });
  }

  async function askCurrentQuestion(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) {
      setStatus("Question is required");
      return;
    }
    const scopedTasks = getAskScopeTasks();
    if (scopedTasks.length === 0) {
      setStatus("No Notion tasks match the current filters");
      return;
    }
    const assistantMessageId = `notion-answer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const userMessage: ChatMessage = { role: "user", content: question, sources: [] };
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "Thinking...",
      sources: [],
      streaming: true
    };
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setQuestion("");
    setAsking(true);
    await runAction("Asking Notion AI", async () => {
      try {
        const answer = await window.denote.askNotion({
          question: userMessage.content,
          history: messages,
          scope: "currentFilteredList",
          taskIds: scopedTasks.map((task) => task.id),
          tasks: scopedTasks
        });
        void revealAssistantMessage({ setMessages, messageId: assistantMessageId, text: answer.text, sources: answer.sources || [] });
        setPendingActionPlan(answer.actionPlan?.actions?.length ? answer.actionPlan : null);
        setStatus("Answered from Notion context");
      } catch (error) {
        void revealAssistantMessage({ setMessages, messageId: assistantMessageId, text: error instanceof Error ? error.message : String(error), sources: [] });
        setStatus("Notion AI request failed");
      } finally {
        setAsking(false);
      }
    });
  }

  function getAskScopeTasks() {
    return filteredTasks;
  }

  async function applyPendingActionPlan() {
    if (!pendingActionPlan || pendingActionPlan.actions.length === 0) {
      setStatus("No pending Notion action");
      return;
    }
    const destructive = pendingActionPlan.actions.some((action) => action.type === "archive_task");
    if (destructive && !window.confirm("Apply destructive Notion action?")) {
      return;
    }
    await runAction("Applying Notion action", async () => {
      await window.denote.applyNotionAction({ plan: pendingActionPlan });
      setPendingActionPlan(null);
      await syncTasks(false);
      setStatus("Notion action applied");
    });
  }

  if (!settings) {
    return null;
  }

  if (!activeToken || enabledSources.length === 0) {
    return (
      <section id="notionTasksView" className="active-view" data-provider-views="notion">
        <section className="panel setup-panel">
          <div className="panel-head">
            <div>
              <h3>Notion setup</h3>
              <p>No Notion task sources selected. Open Settings and click Find Sources for the selected token.</p>
            </div>
            <button onClick={() => setView("settings")} type="button">
              Settings
            </button>
          </div>
        </section>
      </section>
    );
  }

  if (view === "notionAddTask") {
    return (
      <section id="notionAddTaskView" className="workspace-grid active-view" data-provider-views="notion">
        <section className="panel add-panel">
          <div className="panel-head">
            <div>
              <h3>Capture task input</h3>
              <p>Notion content is drafted in English and saved to the selected source.</p>
            </div>
            <button id="generateNotionTaskButton" onClick={() => void generateDraft()} type="button">
              Generate Task
            </button>
          </div>
          <textarea id="notionSourceTextInput" onChange={(event) => setSourceText(event.target.value)} placeholder="Paste task request here..." value={sourceText} />
          <div className="draft-refine">
            <label>
              Refine generated task
              <textarea id="notionDraftQuestionInput" onChange={(event) => setDraftInstruction(event.target.value)} placeholder="Ask AI to adjust the generated Notion task..." value={draftInstruction} />
            </label>
            <button id="refineNotionDraftButton" className="secondary-action" onClick={() => void refineCurrentDraft()} type="button">
              Ask AI
            </button>
          </div>
        </section>

        <form id="notionTaskForm" className="panel card-form" onSubmit={(event) => void createTask(event)}>
          <div className="panel-head">
            <div>
              <h3>Notion task</h3>
              <p>Fields are loaded from the selected Notion source schema.</p>
            </div>
            <button type="submit">Save Task</button>
          </div>
          <NotionTaskForm draft={draft} enabledSources={enabledSources} metadata={metadata} setDraft={setDraft} />
        </form>
      </section>
    );
  }

  if (view === "notionAsk") {
    return (
      <section id="notionAskView" className="active-view" data-provider-views="notion">
        <section className="panel ask-panel">
          <div className="panel-head ask-head">
            <div>
              <h3>Ask Notion</h3>
              <p>{formatAskScopeSummary(filteredTasks.length, tasks.length)}</p>
            </div>
          </div>
          <section id="notionAskFilterPanel" className="ask-filter-panel">
            <div className="ask-filter-head">
              <div>
                <h3>Current filter</h3>
                <p>{formatFilterSummary(filters, filteredTasks.length, tasks.length)}</p>
              </div>
              <button className="secondary-action" onClick={() => setFilters({ status: "", project: "", assignee: "", source: "", query: "" })} type="button">
                Clear filters
              </button>
            </div>
            <NotionFilterControls className="notion-ask-filter-toolbar" tasks={tasks} filters={filters} setFilters={setFilters} />
          </section>
          <ChatThread messages={messages} />
          {detailPreview ? (
            <section className="detail-preview">
              <div className="detail-preview-head">
                <h3>Task detail</h3>
                <button className="secondary-action" onClick={() => setDetailPreview("")} type="button">
                  Clear
                </button>
              </div>
              <pre>{detailPreview}</pre>
            </section>
          ) : null}
          {pendingActionPlan ? (
            <section className="action-preview">
              <h3>Action preview</h3>
              <p>{pendingActionPlan.answer || "Review the proposed Notion changes before applying."}</p>
              <pre>{JSON.stringify(pendingActionPlan.actions, null, 2)}</pre>
              <button id="applyNotionActionButton" onClick={() => void applyPendingActionPlan()} type="button">
                Apply Action
              </button>
            </section>
          ) : null}
          <form id="notionAskForm" className="ask-composer" onSubmit={(event) => void askCurrentQuestion(event)}>
            <textarea id="notionQuestionInput" onChange={(event) => setQuestion(event.target.value)} placeholder="Ask current filtered Notion tasks..." value={question} />
            <button id="notionAskButton" disabled={asking} type="submit">
              Send
            </button>
          </form>
        </section>
      </section>
    );
  }

  return (
    <section id="notionTasksView" className="active-view" data-provider-views="notion">
      <section className="panel notion-task-panel">
        <div className="panel-head">
          <div>
            <h3>Notion tasks</h3>
            <p id="notionTaskCount">{`${filteredTasks.length} of ${tasks.length} tasks${lastSyncedAt ? ` / synced ${lastSyncedAt}` : ""}`}</p>
          </div>
          <div className="notion-panel-actions">
            <label className="inline-toggle">
              <input id="notionIncludeCompletedInput" checked={includeCompleted} onChange={(event) => setIncludeCompleted(event.target.checked)} type="checkbox" />
              Include completed
            </label>
            <button onClick={() => void syncTasks()} type="button">
              Sync
            </button>
            <button onClick={() => setView("notionAsk")} type="button">
              Ask
            </button>
            <button onClick={() => setView("notionAddTask")} type="button">
              Add Task
            </button>
          </div>
        </div>
        <p className="muted">Completed statuses are skipped by default: UAT, Done, Archived.</p>
        {integrationError ? <p className="insufficient">Notion is not connected: {integrationError}</p> : null}
        <NotionFilterControls id="notionTaskFilterToolbar" className="notion-task-filter-toolbar" tasks={tasks} filters={filters} setFilters={setFilters} />
        <details id="notionMobileFilterPanel" className="notion-mobile-filter-panel">
          <summary>Filters</summary>
          <NotionFilterControls className="notion-mobile-filter-fields" tasks={tasks} filters={filters} setFilters={setFilters} />
        </details>
        {filteredTasks.length === 0 ? <p className="muted">No Notion tasks returned for the selected sources.</p> : null}
        <NotionTaskTable
          filteredTasks={filteredTasks}
          openNotionTask={openNotionTask}
          previewTaskDetail={previewTaskDetail}
          archiveTask={archiveTask}
          updateTaskStatus={updateTaskStatus}
        />
        <NotionTaskMobileList
          filteredTasks={filteredTasks}
          openNotionTask={openNotionTask}
          previewTaskDetail={previewTaskDetail}
          archiveTask={archiveTask}
          updateTaskStatus={updateTaskStatus}
        />
      </section>
    </section>
  );
}

export async function discoverAndSelectNotionSource(settings: DenoteSettings, refreshSettings: () => Promise<DenoteSettings>, setSettings: (settings: DenoteSettings) => void): Promise<NotionTaskSource[]> {
  const sources = await window.denote.discoverNotionDatabases({ notionToken: settings.notionToken });
  setSettings(await refreshSettings());
  return sources;
}

function NotionTaskForm({
  draft,
  enabledSources,
  metadata,
  setDraft
}: {
  draft: NotionTaskDraft;
  enabledSources: NotionTaskSource[];
  metadata: NotionMetadata | null;
  setDraft(draft: NotionTaskDraft): void;
}) {
  return (
    <>
      <label>
        Title
        <input id="notionTitleInput" onChange={(event) => setDraft({ ...draft, title: event.target.value })} required value={draft.title} />
      </label>
      <label>
        Description
        <textarea id="notionDescriptionInput" onChange={(event) => setDraft({ ...draft, description: event.target.value })} value={draft.description} />
      </label>
      <section id="notionTaskFields" className="notion-task-fields">
        <div className="field-group-title">Primary</div>
        <label>
          Task source
          <select id="notionTaskSourceInput" onChange={(event) => setDraft({ ...draft, sourceId: event.target.value })} value={draft.sourceId}>
            {enabledSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
        <div className="two-col">
          <label>
            Notion status
            <Select id="notionStatusInput" onChange={(value) => setDraft({ ...draft, status: value })} value={draft.status} values={metadata?.statusOptions || []} />
          </label>
          <label>
            Priority
            <Select id="notionPriorityInput" onChange={(value) => setDraft({ ...draft, priority: value })} value={draft.priority} values={metadata?.priorityOptions || []} />
          </label>
        </div>
        <div className="two-col">
          <label>
            Task type
            <Select id="notionTaskTypeInput" onChange={(value) => setDraft({ ...draft, taskType: value })} value={draft.taskType} values={metadata?.taskTypeOptions || []} />
          </label>
          <label>
            Assign
            <select
              id="notionAssignInput"
              multiple
              onChange={(event) =>
                setDraft({
                  ...draft,
                  assigneeIds: [...event.currentTarget.selectedOptions].map((option) => option.value).filter(Boolean)
                })
              }
              value={draft.assigneeIds}
            >
              {(metadata?.users || []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name || user.id}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Project
          <EntitySelect entities={metadata?.projects || []} id="notionProjectInput" onChange={(value) => setDraft({ ...draft, projectId: value })} value={draft.projectId} />
        </label>
        <details className="advanced-fields">
          <summary>Advanced</summary>
          <div className="two-col">
            <label>
              Due
              <input id="notionDueInput" onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} type="date" value={draft.dueDate} />
            </label>
            <label>
              Task receive date
              <input id="notionTaskReceiveDateInput" onChange={(event) => setDraft({ ...draft, taskReceiveDate: event.target.value })} type="date" value={draft.taskReceiveDate} />
            </label>
          </div>
          <label>
            Sprint
            <EntitySelect entities={metadata?.sprints || []} id="notionSprintInput" onChange={(value) => setDraft({ ...draft, sprintId: value })} value={draft.sprintId} />
          </label>
          <div id="notionReadonlyFields" className="readonly-grid">
            <span>Number and ID are read from Notion after save.</span>
          </div>
        </details>
      </section>
    </>
  );
}

function NotionTaskTable({
  filteredTasks,
  updateTaskStatus,
  openNotionTask,
  previewTaskDetail,
  archiveTask
}: {
  filteredTasks: DenoteNotionTask[];
  updateTaskStatus(task: DenoteNotionTask, status: string): Promise<void>;
  openNotionTask(task: DenoteNotionTask): Promise<void>;
  previewTaskDetail(task: DenoteNotionTask): Promise<void>;
  archiveTask(task: DenoteNotionTask): Promise<void>;
}) {
  return (
    <div id="notionTaskTable" className="notion-task-table-shell">
      <table className="notion-task-table">
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">Status</th>
            <th scope="col">Project</th>
            <th scope="col">Assign</th>
            <th scope="col">Due</th>
            <th scope="col">Type</th>
            <th scope="col">Source</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredTasks.map((task) => (
            <tr key={task.id}>
              <td className="task-title-cell">
                <button className="link-button task-title-button" disabled={!task.url} onClick={() => void openNotionTask(task)} type="button">
                  {task.title || "(Untitled task)"}
                </button>
                <span className="task-subline">{[task.notionId, task.number ? `#${task.number}` : "", formatSprintLabel(task)].filter(Boolean).join(" / ")}</span>
              </td>
              <td>
                <span className="status-chip">{task.status || "No status"}</span>
              </td>
              <td>{formatProjectLabel(task) || <span className="muted-text">No project</span>}</td>
              <td>{formatAssignees(task)}</td>
              <td>{task.dueDate || <span className="muted-text">No due date</span>}</td>
              <td>{[task.priority, task.taskType].filter(Boolean).join(" / ") || <span className="muted-text">None</span>}</td>
              <td>{formatSourceLabel(task) || <span className="muted-text">No source</span>}</td>
              <td>
                <div className="row-actions">
                  <button hidden={isDoneStatus(task.status) || isDeletedStatus(task.status)} onClick={() => void updateTaskStatus(task, "Done")} type="button">
                    Done
                  </button>
                  <button disabled={!task.url} onClick={() => void openNotionTask(task)} type="button">
                    Open
                  </button>
                  <button onClick={() => void previewTaskDetail(task)} type="button">
                    Details
                  </button>
                  <button className="danger-button" onClick={() => void archiveTask(task)} type="button">
                    Archive in Notion
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotionTaskMobileList({
  filteredTasks,
  updateTaskStatus,
  openNotionTask,
  previewTaskDetail,
  archiveTask
}: {
  filteredTasks: DenoteNotionTask[];
  updateTaskStatus(task: DenoteNotionTask, status: string): Promise<void>;
  openNotionTask(task: DenoteNotionTask): Promise<void>;
  previewTaskDetail(task: DenoteNotionTask): Promise<void>;
  archiveTask(task: DenoteNotionTask): Promise<void>;
}) {
  return (
    <div id="notionTaskMobileList" className="notion-task-mobile-list">
      {filteredTasks.map((task) => (
        <article className="notion-task-row-card" key={task.id}>
          <div className="mobile-task-title-row">
            <button className="link-button mobile-task-title" disabled={!task.url} onClick={() => void openNotionTask(task)} type="button">
              {task.title || "(Untitled task)"}
            </button>
          </div>
          <p className="task-subline">{[task.status, formatProjectLabel(task) || "No project", task.dueDate || "No due date"].filter(Boolean).join(" / ")}</p>
          <div className="mobile-task-meta">
            <span>{formatAssignees(task) || "Unassigned"}</span>
            <span>{formatNotionTaskMeta(task)}</span>
          </div>
          <div className="row-actions">
            <button hidden={isDoneStatus(task.status) || isDeletedStatus(task.status)} onClick={() => void updateTaskStatus(task, "Done")} type="button">
              Done
            </button>
            <button disabled={!task.url} onClick={() => void openNotionTask(task)} type="button">
              Open in Notion
            </button>
            <button onClick={() => void previewTaskDetail(task)} type="button">
              Details
            </button>
            <button className="danger-button" onClick={() => void archiveTask(task)} type="button">
              Archive in Notion
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function ChatThread({ messages }: { messages: ChatMessage[] }) {
  return (
    <div id="notionChatThread" className="chat-thread" aria-live="polite">
      {messages.length === 0 ? (
        <div className="chat-empty">
          <strong>No conversation yet.</strong>
          <span>Ask the current filtered Notion task list.</span>
        </div>
      ) : null}
      {messages.map((message, index) => (
        <article className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
          <div className="message-role">{message.role === "user" ? "You" : "Denote"}</div>
          <MarkdownMessage content={message.content} />
          <div className="message-sources">
            {(message.sources || []).map((source) => (
              <blockquote key={`${source.title}-${source.excerpt}`}>
                <strong>{source.title}</strong>
                <p>{source.excerpt}</p>
              </blockquote>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function applyNotionFilters(tasks: DenoteNotionTask[], filters: Filters): DenoteNotionTask[] {
  const query = filters.query.trim().toLowerCase();
  return tasks.filter((task) => matchesNotionTaskFilters(task, filters)).filter((task) => {
    if (!query) {
      return true;
    }
    return `${task.title} ${task.status} ${task.priority} ${task.taskType} ${task.sourceName} ${task.projectNames.join(" ")} ${task.projectIds.join(" ")} ${task.assignees
      .map((person) => `${person.name} ${person.id}`)
      .join(" ")} ${task.notionId} ${task.url}`
      .toLowerCase()
      .includes(query);
  });
}

function matchesNotionTaskFilters(task: DenoteNotionTask, filters: Filters): boolean {
  if (filters.status && task.status !== filters.status) {
    return false;
  }
  if (filters.project && !matchesFilterText([...task.projectNames, ...task.projectIds].join(" "), filters.project)) {
    return false;
  }
  if (filters.assignee && !task.assignees.some((person) => matchesFilterText(`${person.name} ${person.id}`, filters.assignee))) {
    return false;
  }
  if (filters.source && !matchesFilterText(formatSourceLabel(task), filters.source)) {
    return false;
  }
  return true;
}

function matchesFilterText(value: string, filter: string): boolean {
  return value.toLowerCase().includes(filter.trim().toLowerCase());
}

function NotionFilterControls({
  id,
  className,
  tasks,
  filters,
  setFilters
}: {
  id?: string;
  className: string;
  tasks: DenoteNotionTask[];
  filters: Filters;
  setFilters(filters: Filters): void;
}) {
  return (
    <div id={id} className={className}>
      <Combobox id={id ? "notionStatusFilterInput" : "notionStatusFilterInputMobile"} label="Any status" onChange={(value) => setFilters({ ...filters, status: value })} value={filters.status} values={uniqueSorted(tasks.map((task) => task.status))} />
      <Combobox
        id={id ? "notionProjectFilterInput" : "notionProjectFilterInputMobile"}
        label="Any project"
        onChange={(value) => setFilters({ ...filters, project: value })}
        value={filters.project}
        values={uniqueSorted(tasks.flatMap((task) => task.projectNames))}
      />
      <Combobox
        id={id ? "notionAssigneeFilterInput" : "notionAssigneeFilterInputMobile"}
        label="Any assignee"
        onChange={(value) => setFilters({ ...filters, assignee: value })}
        value={filters.assignee}
        values={uniqueSorted(tasks.flatMap((task) => task.assignees.map((assignee) => assignee.name || assignee.id)))}
      />
      <Combobox
        id={id ? "notionSourceFilterInput" : "notionSourceFilterInputMobile"}
        label="Any source"
        onChange={(value) => setFilters({ ...filters, source: value })}
        value={filters.source}
        values={uniqueSorted(tasks.map(formatSourceLabel))}
      />
      <input id={id ? "notionSearchInput" : "notionSearchInputMobile"} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="Search tasks..." value={filters.query} />
    </div>
  );
}

function formatFilterSummary(filters: Filters, filteredCount: number, totalCount: number): string {
  const activeFilters = [
    filters.status ? `Status: ${filters.status}` : "",
    filters.project ? `Project: ${filters.project}` : "",
    filters.assignee ? `Assignee: ${filters.assignee}` : "",
    filters.source ? `Source: ${filters.source}` : "",
    filters.query ? `Search: ${filters.query}` : ""
  ].filter(Boolean);
  return activeFilters.length ? `${activeFilters.join(" / ")} - ${filteredCount} of ${totalCount}` : `No filters - ${filteredCount} of ${totalCount}`;
}

function formatAskScopeSummary(filteredCount: number, totalCount: number): string {
  return `Using ${filteredCount} filtered task${filteredCount === 1 ? "" : "s"} from ${totalCount}`;
}

function formatAssignees(task: DenoteNotionTask): string {
  return task.assignees.map((person) => person.name || person.id).join(", ");
}

function Select({
  id,
  values,
  value,
  onChange,
  includeEmpty,
  label
}: {
  id: string;
  values: string[];
  value: string;
  onChange(value: string): void;
  includeEmpty?: boolean;
  label?: string;
}) {
  return (
    <select id={id} onChange={(event) => onChange(event.target.value)} value={value}>
      {includeEmpty ? <option value="">{label || ""}</option> : null}
      {values.map((item) => (
        <option key={item} value={item}>
          {item}
        </option>
      ))}
    </select>
  );
}

function EntitySelect({ id, entities, value, onChange }: { id: string; entities: EntityOption[]; value: string; onChange(value: string): void }) {
  return (
    <select id={id} onChange={(event) => onChange(event.target.value)} value={value}>
      <option value="">None</option>
      {entities.map((entity) => (
        <option key={entity.id} value={entity.id}>
          {entity.name || entity.title || entity.id}
        </option>
      ))}
    </select>
  );
}
