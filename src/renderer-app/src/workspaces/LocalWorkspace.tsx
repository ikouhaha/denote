import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownMessage } from "../components/MarkdownMessage.js";
import { appendAssistantMessageDelta, replaceAssistantMessage } from "../lib/chatReveal.js";
import { formatDueLabel, formatLocalCardMeta, getLocalDateString, isDeletedStatus, isDoneStatus } from "../lib/format.js";
import type { AppView, ChatMessage, DenoteCard } from "../types.js";

type Props = {
  view: AppView;
  setView(view: AppView): void;
  runAction(label: string, action: () => Promise<void>): Promise<void>;
  setStatus(message: string): void;
};

const emptyDraft: Partial<DenoteCard> = {
  title: "",
  summary: "",
  project: "",
  card_kind: "knowledge",
  status: "open",
  due_date: "",
  due_time: "",
  tags: [],
  content_type: "technical_note",
  source_text: ""
};
const ASK_HISTORY_LIMIT = 3;
const CHAT_MESSAGE_LIMIT = 10;
const ASK_STREAM_FLUSH_MS = 80;
const LIBRARY_SEARCH_LIMIT = 12;

export function LocalWorkspace({ view, setView, runAction, setStatus }: Props) {
  const [cards, setCards] = useState<DenoteCard[]>([]);
  const [sourceText, setSourceText] = useState("");
  const [draft, setDraft] = useState<Partial<DenoteCard>>(emptyDraft);
  const [selectedCardId, setSelectedCardId] = useState("");
  const [libraryFilter, setLibraryFilter] = useState("active");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [aiSearchCards, setAiSearchCards] = useState<DenoteCard[] | null>(null);
  const [aiSearching, setAiSearching] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [asking, setAsking] = useState(false);
  const activeStreamIdRef = useRef<string | null>(null);
  const streamBufferRef = useRef("");
  const streamFlushTimerRef = useRef<number | null>(null);

  useEffect(() => {
    void refreshCards();
    const unsubscribe = window.denote.onCardsChanged?.(() => {
      void refreshCards();
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const unsubscribeDelta = window.denote.onAskDelta((payload) => {
      if (payload.streamId !== activeStreamIdRef.current) return;
      streamBufferRef.current += payload.delta;
      scheduleStreamFlush();
    });
    const unsubscribeDone = window.denote.onAskDone((payload) => {
      if (payload.streamId !== activeStreamIdRef.current) return;
      flushStreamBuffer();
      replaceAssistantMessage({ setMessages, messageId: payload.streamId, text: "", sources: [], streaming: false, preserveExistingContent: true });
      activeStreamIdRef.current = null;
      streamBufferRef.current = "";
      setAsking(false);
      setStatus("Answered by LLM");
    });
    const unsubscribeError = window.denote.onAskError((payload) => {
      if (payload.streamId !== activeStreamIdRef.current) return;
      clearStreamFlushTimer();
      activeStreamIdRef.current = null;
      streamBufferRef.current = "";
      replaceAssistantMessage({ setMessages, messageId: payload.streamId, text: payload.message, sources: [] });
      setAsking(false);
      setStatus("LLM request failed");
    });
    return () => {
      unsubscribeDelta();
      unsubscribeDone();
      unsubscribeError();
      clearStreamFlushTimer();
    };
  }, []);

  async function refreshCards() {
    const loaded = await window.denote.listCards();
    setCards(loaded);
  }

  async function generateDraft() {
    await runAction("Generating card with LLM", async () => {
      const nextDraft = await window.denote.generateDraft(sourceText);
      setSelectedCardId("");
      setDraft(nextDraft);
      setStatus("Draft ready");
    });
  }

  async function saveDraft(event: FormEvent) {
    event.preventDefault();
    await runAction("Saving card", async () => {
      const payload = selectedCardId ? { ...draft, id: selectedCardId } : { ...draft };
      await window.denote.saveCard(payload);
      setSelectedCardId("");
      setDraft(emptyDraft);
      setSourceText("");
      await refreshCards();
      setView("library");
      setStatus("Card saved; sync queued if enabled");
    });
  }

  async function updateCardStatus(card: DenoteCard, status: string) {
    await runAction("Updating card", async () => {
      const result = await window.denote.updateCardStatus({ id: card.id, status });
      if (!result.updated) {
        setStatus("Card already removed");
        return;
      }
      await refreshCards();
      setStatus(isDoneStatus(status) ? "Card marked done; sync queued if enabled" : "Card restored; sync queued if enabled");
    });
  }

  async function deleteCard(card: DenoteCard) {
    if (!window.confirm(`Move "${card.title}" to Trash?`)) {
      return;
    }
    await runAction("Deleting card", async () => {
      const result = await window.denote.deleteCard(card.id);
      if (!result.deleted) {
        setStatus("Card already removed");
        return;
      }
      await refreshCards();
      setStatus("Card moved to Trash; sync queued if enabled");
    });
  }

  async function askCurrentQuestion(event: FormEvent) {
    event.preventDefault();
    if (asking || activeStreamIdRef.current) {
      return;
    }
    if (!question.trim()) {
      setStatus("Question is required");
      return;
    }
    const assistantId = createMessageId("assistant");
    const userMessage: ChatMessage = { id: createMessageId("user"), role: "user", content: question, sources: [] };
    const assistantMessage: ChatMessage = { id: assistantId, role: "assistant", content: "Thinking...", sources: [], streaming: true };
    setMessages((current) => trimChatMessages([...current, userMessage, assistantMessage]));
    setQuestion("");
    setAsking(true);
    activeStreamIdRef.current = assistantId;
    streamBufferRef.current = "";
    clearStreamFlushTimer();
    await runAction("Starting LLM stream", async () => {
      try {
        await window.denote.askStream({ streamId: assistantId, question: userMessage.content, history: buildAskHistory(messages) });
        setStatus("LLM is responding");
      } catch (error) {
        activeStreamIdRef.current = null;
        streamBufferRef.current = "";
        replaceAssistantMessage({ setMessages, messageId: assistantId, text: error instanceof Error ? error.message : String(error), sources: [] });
        setStatus("LLM request failed");
        setAsking(false);
      }
    });
  }

  async function runLibraryAiSearch() {
    if (aiSearching) return;
    if (!libraryQuery.trim()) {
      setStatus("Search query is required");
      return;
    }
    setAiSearching(true);
    await runAction("Running AI search", async () => {
      try {
        const result = await window.denote.aiSearchCards({ query: libraryQuery, filter: libraryFilter, limit: 6 });
        setAiSearchCards(result.cards);
        setStatus(`AI Search found ${result.cards.length} cards`);
      } finally {
        setAiSearching(false);
      }
    });
  }

  function scheduleStreamFlush() {
    if (streamFlushTimerRef.current !== null) return;
    streamFlushTimerRef.current = window.setTimeout(() => {
      streamFlushTimerRef.current = null;
      flushStreamBuffer();
    }, ASK_STREAM_FLUSH_MS);
  }

  function flushStreamBuffer() {
    const streamId = activeStreamIdRef.current;
    const delta = streamBufferRef.current;
    if (!streamId || !delta) return;
    streamBufferRef.current = "";
    appendAssistantMessageDelta({ setMessages, messageId: streamId, delta });
  }

  function clearStreamFlushTimer() {
    if (streamFlushTimerRef.current === null) return;
    window.clearTimeout(streamFlushTimerRef.current);
    streamFlushTimerRef.current = null;
  }

  function editCard(card: DenoteCard) {
    setSelectedCardId(card.id);
    setDraft(card);
    setSourceText(card.source_text);
    setView("add");
    setStatus("Editing card");
  }

  if (view === "add") {
    return (
      <section id="addView" className="workspace-grid active-view" data-provider-views="local">
        <section className="panel add-panel">
          <div className="panel-head">
            <div>
              <h3>Capture text</h3>
              <p>Paste a useful note, then generate an editable card.</p>
            </div>
            <button id="generateButton" onClick={() => void generateDraft()} type="button">
              Generate Card
            </button>
          </div>
          <textarea id="sourceInput" onChange={(event) => setSourceText(event.target.value)} placeholder="Paste knowledge here..." value={sourceText} />
        </section>

        <form id="cardForm" className="panel card-form" onSubmit={(event) => void saveDraft(event)}>
          <div className="panel-head">
            <div>
              <h3>Knowledge Card</h3>
              <p>Review before it enters your local library.</p>
            </div>
            <button id="saveButton" type="submit">
              Save Card
            </button>
          </div>
          <LocalCardForm draft={draft} setDraft={setDraft} />
        </form>
      </section>
    );
  }

  if (view === "library") {
    const localRankedCards = rankLibraryCards(
      cards.filter((card) => matchesLibraryFilter(card, libraryFilter)),
      libraryQuery
    );
    const filteredCards = aiSearchCards ?? localRankedCards;
    const searchMode = aiSearchCards ? "AI ranked" : libraryQuery.trim() ? "Local ranked" : "Recent";
    return (
      <section id="libraryView" className="active-view" data-provider-views="local">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>Library</h3>
              <p id="cardCount">{`${filteredCards.length} of ${cards.length} cards · ${searchMode}`}</p>
            </div>
            <div className="library-tools">
              <select id="libraryFilterInput" onChange={(event) => { setLibraryFilter(event.target.value); setAiSearchCards(null); }} value={libraryFilter}>
                <option value="active">Active</option>
                <option value="all">All</option>
                <option value="knowledge">Knowledge</option>
                <option value="schedule">Schedule</option>
                <option value="done">Done</option>
                <option value="trash">Trash</option>
              </select>
              <input id="librarySearchInput" className="toolbar-input" onChange={(event) => { setLibraryQuery(event.target.value); setAiSearchCards(null); }} placeholder="Search cards..." value={libraryQuery} />
              <button className="secondary-action" disabled={aiSearching || !libraryQuery.trim()} id="libraryAiSearchButton" onClick={() => void runLibraryAiSearch()} type="button">
                AI Search
              </button>
            </div>
          </div>
          <div id="cardList" className="card-list">
            {filteredCards.length === 0 ? <p className="muted">No cards yet. Save a card from Add to build your own library.</p> : null}
            {filteredCards.map((card) => (
              <article className="knowledge-card" key={card.id}>
                <div className="card-title-row">
                  <h3>{card.title}</h3>
                  <div className="card-actions">
                    <button aria-label={`Edit card ${card.title}`} onClick={() => editCard(card)} type="button">
                      Edit card
                    </button>
                    <button hidden={isDoneStatus(card.status) || isDeletedStatus(card.status)} onClick={() => void updateCardStatus(card, "done")} type="button">
                      Done
                    </button>
                    <button hidden={!isDeletedStatus(card.status)} onClick={() => void updateCardStatus(card, "open")} type="button">
                      Restore
                    </button>
                    <button className="danger-button" onClick={() => void deleteCard(card)} type="button">
                      Delete
                    </button>
                  </div>
                </div>
                <div className={`project-pill ${card.project ? "" : "empty-project"}`}>{card.project || "No project"}</div>
                <div className="card-meta">{formatLocalCardMeta(card)}</div>
                <p className="summary">{card.summary}</p>
                <div className="tags">{card.tags.map((tag) => `#${tag}`).join(" ")}</div>
              </article>
            ))}
          </div>
        </section>
      </section>
    );
  }

  if (view === "calendar") {
    return <LocalCalendar cards={cards} deleteCard={deleteCard} editCard={editCard} updateCardStatus={updateCardStatus} />;
  }

  if (view === "ask") {
    return (
      <section id="askView" className="active-view" data-provider-views="local">
        <section className="panel ask-panel">
          <div className="panel-head">
            <div>
              <h3>Ask saved knowledge</h3>
              <p>LLM answers using saved local cards as context.</p>
            </div>
          </div>
          <div id="chatThread" className="chat-thread">
            {messages.length === 0 ? (
              <div className="chat-empty">
                <strong>No conversation yet.</strong>
                <span>Ask after you save cards to your local library.</span>
              </div>
            ) : null}
            {messages.map((message, index) => (
              <article className={`chat-message ${message.role}`} key={message.id || `${message.role}-${index}`}>
                <div className="message-role">{message.role === "user" ? "You" : "Denote"}</div>
                {message.streaming ? <p className="message-content streaming-placeholder">{message.content}</p> : <MarkdownMessage content={message.content} />}
              </article>
            ))}
          </div>
          <form id="askForm" className="ask-composer" onSubmit={(event) => void askCurrentQuestion(event)}>
            <textarea id="questionInput" onChange={(event) => setQuestion(event.target.value)} placeholder="Ask your saved knowledge..." value={question} />
            <button id="askButton" disabled={asking} type="submit">
              Send
            </button>
          </form>
        </section>
      </section>
    );
  }

  return null;
}

function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function trimChatMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-CHAT_MESSAGE_LIMIT);
}

function buildAskHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.role === "user")
    .slice(-ASK_HISTORY_LIMIT)
    .map((message) => ({ role: "user", content: message.content, sources: [] }));
}

function LocalCardForm({ draft, setDraft }: { draft: Partial<DenoteCard>; setDraft(draft: Partial<DenoteCard>): void }) {
  function update(field: keyof DenoteCard, value: string) {
    setDraft({ ...draft, [field]: field === "tags" ? value.split(",").map((tag) => tag.trim()).filter(Boolean) : value });
  }

  return (
    <>
      <label>
        Title
        <input id="titleInput" onChange={(event) => update("title", event.target.value)} required value={draft.title || ""} />
      </label>
      <label>
        Summary
        <textarea id="summaryInput" onChange={(event) => update("summary", event.target.value)} required value={draft.summary || ""} />
      </label>
      <div className="two-col">
        <label>
          Project
          <input id="projectInput" onChange={(event) => update("project", event.target.value)} placeholder="QVAT, Vendor DB, Personal..." value={draft.project || ""} />
        </label>
        <label>
          Card kind
          <select id="cardKindInput" onChange={(event) => update("card_kind", event.target.value)} value={draft.card_kind || "knowledge"}>
            <option value="knowledge">Knowledge</option>
            <option value="task">Task</option>
            <option value="event">Event</option>
            <option value="reminder">Reminder</option>
          </select>
        </label>
      </div>
      <div className="two-col">
        <label>
          Content type
          <select id="contentTypeInput" onChange={(event) => update("content_type", event.target.value)} value={draft.content_type || "technical_note"}>
            <option value="technical_note">Technical note</option>
            <option value="project_note">Project note</option>
            <option value="reference">Reference</option>
            <option value="personal_note">Personal note</option>
            <option value="captured_qa">Captured Q&amp;A</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Status
          <select id="statusInput" onChange={(event) => update("status", event.target.value)} value={draft.status || "open"}>
            <option value="open">Open</option>
            <option value="done">Done</option>
            <option value="archived">Archived</option>
            <option value="deleted">Deleted</option>
          </select>
        </label>
      </div>
      <div className="two-col">
        <label>
          Due date
          <input id="dueDateInput" onChange={(event) => update("due_date", event.target.value)} type="date" value={draft.due_date || ""} />
        </label>
        <label>
          Due time
          <input id="dueTimeInput" onChange={(event) => update("due_time", event.target.value)} type="time" value={draft.due_time || ""} />
        </label>
      </div>
      <label>
        Tags
        <input id="tagsInput" onChange={(event) => update("tags", event.target.value)} placeholder="rag, sqlite, vendor" value={(draft.tags || []).join(", ")} />
      </label>
      <label>
        Source text
        <textarea id="sourceReviewInput" onChange={(event) => update("source_text", event.target.value)} required value={draft.source_text || ""} />
      </label>
    </>
  );
}

function LocalCalendar({
  cards,
  deleteCard,
  editCard,
  updateCardStatus
}: {
  cards: DenoteCard[];
  deleteCard(card: DenoteCard): Promise<void>;
  editCard(card: DenoteCard): void;
  updateCardStatus(card: DenoteCard, status: string): Promise<void>;
}) {
  const scheduledCards = useMemo(
    () =>
      cards
        .filter((card) => ["task", "event", "reminder"].includes(card.card_kind || "knowledge"))
        .filter((card) => !isDeletedStatus(card.status))
        .sort((a, b) => `${a.due_date || "9999-12-31"} ${a.due_time || "23:59"}`.localeCompare(`${b.due_date || "9999-12-31"} ${b.due_time || "23:59"}`)),
    [cards]
  );
  const groups = [
    { key: "today", title: "Today", cards: scheduledCards.filter((card) => getCalendarGroup(card) === "today") },
    { key: "tomorrow", title: "Tomorrow", cards: scheduledCards.filter((card) => getCalendarGroup(card) === "tomorrow") },
    { key: "upcoming", title: "Upcoming", cards: scheduledCards.filter((card) => getCalendarGroup(card) === "upcoming") },
    { key: "noDate", title: "No date", cards: scheduledCards.filter((card) => getCalendarGroup(card) === "noDate") }
  ];

  return (
    <section id="calendarView" className="active-view" data-provider-views="local">
      <section className="panel calendar-panel">
        <div className="panel-head">
          <div>
            <h3>Calendar</h3>
            <p id="calendarCount">{`${scheduledCards.length} scheduled ${scheduledCards.length === 1 ? "card" : "cards"}`}</p>
          </div>
        </div>
        <div id="calendarBoard" className="calendar-board">
          {groups.map((group) => (
            <section className="calendar-group" key={group.key}>
              <div className="calendar-group-head">
                <h3>{group.title}</h3>
                <span>{group.cards.length}</span>
              </div>
              <div className="calendar-items">
                {group.cards.length === 0 ? <p className="muted">No cards</p> : null}
                {group.cards.map((card) => (
                  <article className="calendar-card" key={card.id}>
                    <div>
                      <div className="calendar-date">{formatDueLabel(card)}</div>
                      <h4>{card.title}</h4>
                      <p>{card.summary}</p>
                      <div className="card-meta">{formatLocalCardMeta(card)}</div>
                    </div>
                    <div className="card-actions">
                      <button onClick={() => editCard(card)} type="button">
                        Edit
                      </button>
                      <button hidden={isDoneStatus(card.status)} onClick={() => void updateCardStatus(card, "done")} type="button">
                        Done
                      </button>
                      <button className="danger-button" onClick={() => void deleteCard(card)} type="button">
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </section>
  );
}

function getCalendarGroup(card: DenoteCard): string {
  if (!card.due_date) {
    return "noDate";
  }
  if (card.due_date === getLocalDateString(0)) {
    return "today";
  }
  if (card.due_date === getLocalDateString(1)) {
    return "tomorrow";
  }
  return "upcoming";
}

function matchesLibraryFilter(card: DenoteCard, filter: string): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "active") {
    return !isDeletedStatus(card.status) && !isDoneStatus(card.status);
  }
  if (filter === "knowledge") {
    return card.card_kind === "knowledge" && !isDeletedStatus(card.status);
  }
  if (filter === "schedule") {
    return ["task", "event", "reminder"].includes(card.card_kind) && !isDeletedStatus(card.status);
  }
  if (filter === "done") {
    return isDoneStatus(card.status);
  }
  if (filter === "trash") {
    return isDeletedStatus(card.status);
  }
  return true;
}

function rankLibraryCards(cards: DenoteCard[], query: string): DenoteCard[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return cards;
  }
  return cards
    .map((card) => ({ card, score: scoreLibraryCard(card, needle) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || b.card.updated_at.localeCompare(a.card.updated_at))
    .slice(0, LIBRARY_SEARCH_LIMIT)
    .map((result) => result.card);
}

function scoreLibraryCard(card: DenoteCard, query: string): number {
  const terms = tokenizeSearchQuery(query);
  const fields = [
    { value: card.title, weight: 12 },
    { value: card.project, weight: 8 },
    { value: card.tags.join(" "), weight: 7 },
    { value: card.summary, weight: 5 },
    { value: `${card.card_kind} ${card.status} ${card.due_date} ${card.due_time}`, weight: 3 },
    { value: card.source_text, weight: 2 }
  ];
  let score = 0;
  for (const field of fields) {
    const value = field.value.toLowerCase();
    if (value.includes(query)) {
      score += field.weight * 3;
    }
    for (const term of terms) {
      if (value.includes(term)) {
        score += field.weight;
      }
    }
  }
  return score;
}

function tokenizeSearchQuery(query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  return needle.split(/[^a-z0-9-]+/).filter((term) => term.length >= 2);
}
