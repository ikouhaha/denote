import type { Dispatch, SetStateAction } from "react";
import type { ChatMessage } from "../types.js";

const REVEAL_INTERVAL_MS = 14;
const MIN_REVEAL_CHUNK_LENGTH = 10;
const MAX_REVEAL_CHUNKS = 80;

export async function revealAssistantMessage({
  setMessages,
  messageId,
  text,
  sources = []
}: {
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  messageId?: string | undefined;
  text: string;
  sources?: ChatMessage["sources"];
}): Promise<void> {
  const chunks = splitRevealChunks(text);
  let content = "";
  for (const chunk of chunks) {
    content += chunk;
    setMessages((current) => replaceStreamingAssistant(current, buildAssistantRevealMessage({ messageId, content, sources: [], streaming: true })));
    await wait(REVEAL_INTERVAL_MS);
  }
  setMessages((current) => replaceStreamingAssistant(current, buildAssistantRevealMessage({ messageId, content: text, sources, streaming: false })));
}

export function replaceAssistantMessage({
  setMessages,
  messageId,
  text,
  sources = [],
  streaming = false,
  preserveExistingContent = false
}: {
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  messageId?: string | undefined;
  text: string;
  sources?: ChatMessage["sources"];
  streaming?: boolean;
  preserveExistingContent?: boolean;
}): void {
  setMessages((current) => replaceStreamingAssistant(current, buildAssistantRevealMessage({ messageId, content: text, sources, streaming, preserveExistingContent })));
}

export function appendAssistantMessageDelta({
  setMessages,
  messageId,
  delta
}: {
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  messageId: string;
  delta: string;
}): void {
  setMessages((current) =>
    replaceStreamingAssistant(current, buildAssistantRevealMessage({ messageId, content: delta, sources: [], streaming: true, appendContent: true }))
  );
}

export function splitRevealChunks(text: string): string[] {
  const tokens = String(text || "").match(/\S+\s*/g) || [""];
  const chunks: string[] = [];
  let current = "";
  for (const token of tokens) {
    current += token;
    if (current.length >= MIN_REVEAL_CHUNK_LENGTH || token.includes("\n")) {
      chunks.push(current);
      current = "";
    }
  }
  if (current) {
    chunks.push(current);
  }
  return compactRevealChunks(chunks.length ? chunks : [""], MAX_REVEAL_CHUNKS);
}

function compactRevealChunks(chunks: string[], maxChunks: number): string[] {
  if (chunks.length <= maxChunks) {
    return chunks;
  }
  const groupSize = Math.ceil(chunks.length / maxChunks);
  const compacted: string[] = [];
  for (let index = 0; index < chunks.length; index += groupSize) {
    compacted.push(chunks.slice(index, index + groupSize).join(""));
  }
  return compacted;
}

type AssistantMessagePatch = ChatMessage & {
  appendContent?: boolean;
  preserveExistingContent?: boolean;
};

function replaceStreamingAssistant(messages: ChatMessage[], nextMessage: AssistantMessagePatch): ChatMessage[] {
  let index = -1;
  if (nextMessage.id) {
    index = messages.findIndex((message) => message.id === nextMessage.id);
  }
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    if (index !== -1) {
      break;
    }
    const message = messages[messageIndex];
    if (message?.role === "assistant" && message.streaming) {
      index = messageIndex;
      break;
    }
  }
  if (index === -1) {
    return [...messages, stripAssistantPatchMeta(nextMessage)];
  }
  return messages.map((message, messageIndex) => {
    if (messageIndex !== index) return message;
    const content = nextMessage.appendContent ? `${message.content === "Thinking..." ? "" : message.content}${nextMessage.content}` : nextMessage.preserveExistingContent ? message.content : nextMessage.content;
    return stripAssistantPatchMeta({
      ...nextMessage,
      content,
      sources: nextMessage.sources?.length ? nextMessage.sources : message.sources || []
    });
  });
}

function stripAssistantPatchMeta(message: AssistantMessagePatch): ChatMessage {
  const { appendContent: _appendContent, preserveExistingContent: _preserveExistingContent, ...clean } = message;
  return clean;
}

function buildAssistantRevealMessage({
  messageId,
  content,
  sources,
  streaming,
  appendContent = false,
  preserveExistingContent = false
}: {
  messageId: string | undefined;
  content: string;
  sources: ChatMessage["sources"];
  streaming: boolean;
  appendContent?: boolean;
  preserveExistingContent?: boolean;
}): ChatMessage & { appendContent?: boolean; preserveExistingContent?: boolean } {
  return {
    ...(messageId ? { id: messageId } : {}),
    role: "assistant",
    content,
    sources: sources || [],
    streaming,
    appendContent,
    preserveExistingContent
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
