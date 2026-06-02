import { chromium } from "playwright";

const appUrl = process.env.DENOTE_SMOKE_URL || "http://127.0.0.1:5173";

function installTauriMock() {
  const registry = new Map();
  let nextEventId = 1;
  const cards = [];
  const settings = {
    syncProvider: "cloudflare",
    taskProvider: "local",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "smoke-api-key",
    chatModel: "gpt-4.1-mini",
    embeddingModel: "text-embedding-3-small",
    cloudflare: {
      endpoint: "https://denote-sync-api.ikouhaha888.workers.dev",
      licenseKey: "dn_live_smoke-smoke-smoke-smoke-smoke",
      autoSyncEnabled: true,
      lastSyncedAt: ""
    }
  };
  const smoke = {
    askFallbackCalls: 0,
    aiSearchCalls: [],
    askStreamCalls: [],
    emittedDeltas: 0,
    savedCards: cards,
    listenerAdds: [],
    listenerRemoves: []
  };

  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function emit(event, payload) {
    for (const handlerId of registry.get(event)?.values() || []) {
      const callback = window[`_${handlerId}`];
      if (callback) callback({ event, payload });
    }
  }

  window.__denoteSmoke = smoke;
  window.__TAURI_INTERNALS__ = {
    transformCallback(callback) {
      const id = Math.floor(Math.random() * 1000000000);
      window[`_${id}`] = callback;
      return id;
    },
    async invoke(command, args = {}) {
      if (command === "plugin:event|listen") {
        const id = nextEventId++;
        if (!registry.has(args.event)) registry.set(args.event, new Map());
        registry.get(args.event).set(id, args.handler);
        smoke.listenerAdds.push({ id, event: args.event });
        return id;
      }
      if (command === "plugin:event|unlisten") {
        for (const [event, eventListeners] of registry.entries()) {
          if (eventListeners.delete(args.eventId)) smoke.listenerRemoves.push({ id: args.eventId, event });
        }
        return null;
      }
      if (command === "get_app_info") return { version: "smoke" };
      if (command === "get_settings") return settings;
      if (command === "get_diagnostics") {
        return { userDataPath: "smoke-data", logFilePath: "smoke.log", cardsFilePath: "cards.json", settingsFilePath: "settings.json" };
      }
      if (command === "get_update_state") return { status: "idle", message: "Ready to check for updates" };
      if (command === "list_cards") return [...cards].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      if (command === "ai_search_cards") {
        smoke.aiSearchCalls.push(args.payload);
        const query = String(args.payload.query || "").toLowerCase();
        const firstTerm = query.split(/\s+/).find(Boolean) || query;
        return {
          cards: cards.filter((card) => `${card.title} ${card.summary} ${card.project} ${card.tags.join(" ")} ${card.source_text}`.toLowerCase().includes(firstTerm))
        };
      }
      if (command === "generate_draft") {
        const source = args.sourceText || "";
        return {
          id: "",
          title: source.includes("Expert Systems") ? "Expert Systems Interview Prep" : "Smoke Card",
          summary: `Summary for ${source.slice(0, 48)}`,
          project: source.includes("Expert Systems") ? "Expert Systems" : "Smoke",
          card_kind: "knowledge",
          status: "open",
          due_date: "",
          due_time: "",
          tags: ["smoke", "ask"],
          content_type: "technical_note",
          source_text: source,
          updated_at: new Date().toISOString()
        };
      }
      if (command === "save_card") {
        const now = new Date().toISOString();
        const card = {
          id: args.card.id || `smoke-${cards.length + 1}`,
          title: args.card.title,
          summary: args.card.summary,
          project: args.card.project || "",
          card_kind: args.card.card_kind || "knowledge",
          status: args.card.status || "open",
          due_date: args.card.due_date || "",
          due_time: args.card.due_time || "",
          tags: args.card.tags || [],
          content_type: args.card.content_type || "technical_note",
          source_text: args.card.source_text,
          created_at: args.card.created_at || now,
          updated_at: now
        };
        const index = cards.findIndex((item) => item.id === card.id);
        if (index === -1) cards.push(card);
        else cards[index] = card;
        emit("denote:cardsChanged", { reason: "smoke.save" });
        return card;
      }
      if (command === "ask") {
        smoke.askFallbackCalls += 1;
        throw new Error("Smoke test should use ask_stream, not ask");
      }
      if (command === "ask_stream") {
        const { streamId, question, history } = args.payload;
        smoke.askStreamCalls.push({ streamId, question, history });
        const answer =
          question.includes("為什麼選expert systems") || question.includes("為什麼選 Expert Systems")
            ? "### 為什麼選 Expert Systems\n我選 Expert Systems，主要因為 enterprise IT solutions、system integration 同 hands-on Systems Analyst delivery ownership 都同我經驗匹配。"
            : "### 這張卡是在做什麼\n這張卡是 Expert Systems Systems Analyst Interview Q&A 的面試準備筆記。";
        setTimeout(async () => {
          for (const token of answer.match(/\S+\s*/g) || [answer]) {
            smoke.emittedDeltas += 1;
            emit("denote:askDelta", { streamId, delta: token });
            await sleep(3);
          }
          emit("denote:askDone", { streamId, sources: [{ title: "Expert Systems Interview Prep", excerpt: question }] });
        }, 20);
        return { streamId };
      }
      if (command === "save_settings") {
        Object.assign(settings, args.settings);
        return settings;
      }
      if (command === "test_cloudflare_sync_connection") return { connected: true, cardCount: cards.length, updatedAt: "" };
      if (command === "sync_cloudflare_now") return { synced: true, cardCount: cards.length, updatedAt: new Date().toISOString() };
      if (command === "check_for_updates") return { status: "idle", message: "Ready to check for updates" };
      return null;
    }
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
}

async function setReactInputValue(page, selector, value) {
  await page.locator(selector).evaluate((element, nextValue) => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, nextValue);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: nextValue }));
  }, value);
}

async function waitForIdle(page) {
  await page.waitForFunction(() => document.querySelector("#status")?.getAttribute("aria-busy") === "false", undefined, { timeout: 10000 });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
const consoleMessages = [];
page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) consoleMessages.push(`${message.type()}: ${message.text()}`);
});
page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await page.addInitScript(installTauriMock);

try {
  await page.goto(appUrl, { wait_until: "networkidle" });
  await page.waitForSelector("#viewTitle");
  assert((await page.locator("#viewTitle").innerText()) === "Add knowledge", "App did not open on Add view");

  await setReactInputValue(page, "#sourceInput", "Expert Systems Systems Analyst Interview Q&A source for smoke test");
  await page.locator("#generateButton").click();
  await waitForIdle(page);
  await page.locator("#saveButton").click();
  await waitForIdle(page);
  await page.locator('button[data-view="library"]').click();
  await page.waitForSelector("#cardList .knowledge-card");
  assert((await page.locator("#cardList").innerText()).includes("Expert Systems Interview Prep"), "Saved card did not appear in Library");
  await setReactInputValue(page, "#librarySearchInput", "Expert Systems");
  await page.locator("#libraryAiSearchButton").click();
  await waitForIdle(page);
  assert((await page.locator("#cardCount").innerText()).includes("AI ranked"), "Library did not show AI ranked search results");
  await page.locator("#cardList .knowledge-card").first().locator("button", { hasText: "Edit card" }).click();
  await page.waitForSelector("#titleInput");
  assert((await page.locator("#viewTitle").innerText()) === "Add knowledge", "Edit card did not navigate to Add view");
  assert((await page.locator("#titleInput").inputValue()) === "Expert Systems Interview Prep", "Edit card did not load the selected card");

  await page.locator('button[data-view="ask"]').click();
  await page.waitForSelector("#askForm");
  await setReactInputValue(page, "#questionInput", "Expert Systems Systems Analyst Interview Q&A 是在做什麼呢 完整的給我看看");
  await page.locator("#askForm").evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => !document.querySelector("#askButton")?.disabled, undefined, { timeout: 10000 });
  const firstAnswer = await page.locator("#chatThread article.assistant").last().innerText();
  assert(firstAnswer.includes("這張卡是在做什麼"), "First Ask answer did not stream expected card explanation");

  await setReactInputValue(page, "#questionInput", "別人如果問你為什麼選expert systems 要怎麼回答");
  await page.locator("#askForm").evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => !document.querySelector("#askButton")?.disabled, undefined, { timeout: 10000 });
  const secondAnswer = await page.locator("#chatThread article.assistant").last().innerText();
  assert(secondAnswer.includes("為什麼選 Expert Systems"), "Second Ask answer did not focus on the current question");
  assert(!secondAnswer.startsWith("這張卡是在做什麼"), "Second Ask answer was polluted by the previous question");

  assert((await page.locator(".message-sources").count()) === 0, "Ask rendered source/card list blocks");
  const askMessagesBeforeTabSwitch = await page.locator("#chatThread article.chat-message").count();
  await page.locator('button[data-view="settings"]').click();
  await page.waitForSelector("#cloudflareLicenseKeyInput");
  await page.locator('button[data-view="ask"]').click();
  await page.waitForSelector("#askForm");
  const askMessagesAfterTabSwitch = await page.locator("#chatThread article.chat-message").count();
  assert(askMessagesAfterTabSwitch === askMessagesBeforeTabSwitch, "Ask chat history was lost after switching tabs");

  const smokeState = await page.evaluate(() => window.__denoteSmoke);
  assert(smokeState.aiSearchCalls.length === 1, `Expected 1 AI search call, got ${smokeState.aiSearchCalls.length}`);
  assert(smokeState.askFallbackCalls === 0, "Ask fallback was called instead of ask_stream");
  assert(smokeState.askStreamCalls.length === 2, `Expected 2 streamed Ask calls, got ${smokeState.askStreamCalls.length}`);
  assert(smokeState.askStreamCalls[1].question === "別人如果問你為什麼選expert systems 要怎麼回答", "Second streamed question payload was incorrect");
  const askChatMessages = askMessagesAfterTabSwitch;
  assert(askChatMessages <= 10, "Chat DOM exceeded retained message limit");

  await page.locator('button[data-view="settings"]').click();
  await page.waitForSelector("#cloudflareLicenseKeyInput");
  await page.waitForFunction(() => document.querySelector("#cloudflareLicenseKeyInput")?.value?.startsWith("dn_live_"), undefined, { timeout: 5000 });
  assert((await page.locator("#cloudflareLicenseKeyInput").inputValue()).startsWith("dn_live_"), "Settings license key did not load");

  const result = {
    ok: true,
    aiSearchCalls: smokeState.aiSearchCalls.length,
    askStreamCalls: smokeState.askStreamCalls.length,
    emittedDeltas: smokeState.emittedDeltas,
    savedCards: smokeState.savedCards.length,
    askChatMessages,
    consoleMessages
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
