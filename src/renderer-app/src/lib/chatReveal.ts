import type { Dispatch, SetStateAction } from "react";
import type { ChatMessage } from "../types.js";

const REVEAL_INTERVAL_MS = 14;
const MIN_REVEAL_CHUNK_LENGTH = 10;

export async function revealAssistantMessage({
  setMessages,
  text,
  sources = []
}: {
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  text: string;
  sources?: ChatMessage["sources"];
}): Promise<void> {
  const chunks = splitRevealChunks(text);
  let content = "";
  for (const chunk of chunks) {
    content += chunk;
    setMessages((current) => replaceStreamingAssistant(current, { role: "assistant", content, sources: [], streaming: true }));
    await wait(REVEAL_INTERVAL_MS);
  }
  setMessages((current) => replaceStreamingAssistant(current, { role: "assistant", content: text, sources, streaming: false }));
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
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
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

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
