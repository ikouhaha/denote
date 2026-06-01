import type { DenoteCard, DenoteNotionTask } from "../types.js";

export function normalizeStatus(value: string | undefined): string {
  return String(value || "").trim().toLowerCase();
}

export function isDoneStatus(value: string | undefined): boolean {
  return normalizeStatus(value) === "done";
}

export function isDeletedStatus(value: string | undefined): boolean {
  return ["deleted", "archived"].includes(normalizeStatus(value));
}

export function uniqueSorted(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function formatLocalCardMeta(card: DenoteCard): string {
  const due = [card.due_date, card.due_time].filter(Boolean).join(" ");
  return [card.card_kind || "knowledge", card.status || "open", due].filter(Boolean).join(" / ");
}

export function formatNotionTaskMeta(task: DenoteNotionTask): string {
  return [task.status, task.priority, task.taskType, task.dueDate, formatSourceLabel(task)].filter(Boolean).join(" / ");
}

export function formatSourceLabel(task: DenoteNotionTask): string {
  if (task.sourceName && !looksLikeOpaqueId(task.sourceName)) {
    return task.sourceName;
  }
  return task.sourceId ? "Unnamed source" : "";
}

export function formatProjectLabel(task: DenoteNotionTask): string {
  if (task.projectNames.length) {
    return task.projectNames.join(", ");
  }
  if (task.projectIds.length) {
    return "Unresolved project";
  }
  return "";
}

export function formatSprintLabel(task: DenoteNotionTask): string {
  if (task.sprintNames.length) {
    return task.sprintNames.join(", ");
  }
  if (task.sprintIds.length) {
    return "Unresolved sprint";
  }
  return "";
}

export function formatDueLabel(card: DenoteCard): string {
  return [card.due_date, card.due_time].filter(Boolean).join(" ") || "No date";
}

export function getLocalDateString(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function looksLikeOpaqueId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}
