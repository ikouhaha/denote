import type { Dispatch, SetStateAction } from "react";
import type { ChatMessage } from "../types.js";

const REVEAL_INTERVAL_MS = 14;
const MIN_REVEAL_CHUNK_LENGTH = 10;

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
  return chunks.length ? chunks : [""];
}

function replaceStreamingAssistant(messages: ChatMessage[], nextMessage: ChatMessage): ChatMessage[] {
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
    return [...messages, nextMessage];
  }
  return messages.map((message, messageIndex) => (messageIndex === index ? nextMessage : message));
}

function buildAssistantRevealMessage({
  messageId,
  content,
  sources,
  streaming
}: {
  messageId: string | undefined;
  content: string;
  sources: ChatMessage["sources"];
  streaming: boolean;
}): ChatMessage {
  return {
    ...(messageId ? { id: messageId } : {}),
    role: "assistant",
    content,
    sources: sources || [],
    streaming
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
