import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const localWorkspaceSource = readFileSync(resolve("src/renderer-app/src/workspaces/LocalWorkspace.tsx"), "utf8");
const chatRevealSource = readFileSync(resolve("src/renderer-app/src/lib/chatReveal.ts"), "utf8");

describe("Ask UI responsiveness contract", () => {
  it("uses real stream events instead of fake progressive reveal", () => {
    expect(localWorkspaceSource).toContain("window.denote.askStream");
    expect(localWorkspaceSource).toContain("onAskDelta");
    expect(localWorkspaceSource).toContain("onAskDone");
    expect(localWorkspaceSource).toContain("appendAssistantMessageDelta");
    expect(localWorkspaceSource).toContain("streamBufferRef.current += payload.delta");
    expect(localWorkspaceSource).not.toContain("await revealAssistantMessage");
    expect(localWorkspaceSource).not.toContain("REVEAL_INTERVAL_MS");
  });

  it("bounds retained chat DOM after repeated questions", () => {
    expect(localWorkspaceSource).toContain("const CHAT_MESSAGE_LIMIT = 10");
    expect(localWorkspaceSource).toContain("messages.slice(-CHAT_MESSAGE_LIMIT)");
    expect(localWorkspaceSource).toContain("setMessages((current) => trimChatMessages([...current, userMessage, assistantMessage]))");
  });

  it("buffers deltas so each token does not cause a React render", () => {
    expect(localWorkspaceSource).toContain("const ASK_STREAM_FLUSH_MS = 80");
    expect(localWorkspaceSource).toContain("window.setTimeout");
    expect(localWorkspaceSource).toContain("flushStreamBuffer");
  });

  it("keeps the progressive reveal helper available but out of Ask", () => {
    expect(chatRevealSource).toContain("revealAssistantMessage");
    expect(chatRevealSource).toContain("replaceAssistantMessage");
  });
});
