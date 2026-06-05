import { getMessages } from "./i18n.js";
import type { AppView, DenoteLanguage } from "../types.js";

export function getViewTitle(view: AppView, language: DenoteLanguage = "en"): string {
  const titles = getMessages(language).viewTitles;
  return titles[view] || view;
}
