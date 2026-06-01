import type { AppView } from "../types.js";

export function getViewTitle(view: AppView): string {
  const titles: Record<AppView, string> = {
    add: "Add knowledge",
    library: "Library",
    calendar: "Calendar",
    ask: "Ask",
    settings: "Settings"
  };
  return titles[view] || view;
}
