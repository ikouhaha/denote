import type { AppView, TaskProvider } from "../types.js";

export const providerViews: Record<TaskProvider, AppView[]> = {
  local: ["add", "library", "calendar", "ask", "settings"],
  notion: ["notionTasks", "notionAddTask", "notionAsk", "settings"]
};

export function getDefaultViewForProvider(provider: TaskProvider): AppView {
  return provider === "notion" ? "notionTasks" : "add";
}

export function coerceViewForProvider(provider: TaskProvider, view: AppView): AppView {
  return providerViews[provider]?.includes(view) ? view : getDefaultViewForProvider(provider);
}

export function getViewTitle(view: AppView): string {
  const titles: Record<AppView, string> = {
    add: "Add knowledge",
    library: "Library",
    calendar: "Calendar",
    ask: "Ask",
    notionTasks: "Notion tasks",
    notionAddTask: "Add Notion task",
    notionAsk: "Notion Ask",
    settings: "Settings"
  };
  return titles[view] || view;
}
