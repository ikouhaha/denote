import type { DenoteCard } from "../types.js";

export function normalizeStatus(value: string | undefined): string {
  return String(value || "").trim().toLowerCase();
}

export function isDoneStatus(value: string | undefined): boolean {
  return normalizeStatus(value) === "done";
}

export function isDeletedStatus(value: string | undefined): boolean {
  return ["deleted", "archived"].includes(normalizeStatus(value));
}

export function formatLocalCardMeta(card: DenoteCard): string {
  const due = [card.due_date, card.due_time].filter(Boolean).join(" ");
  return [card.card_kind || "knowledge", card.status || "open", due].filter(Boolean).join(" / ");
}

export function formatDueLabel(card: DenoteCard): string {
  return [card.due_date, card.due_time].filter(Boolean).join(" ") || "No date";
}

export function formatSyncTimestamp(value: string): string {
  const text = value.trim();
  if (!text) {
    return "Never";
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

export function getLocalDateString(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
