import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CloudflareSyncSettings, DenoteApi, DenoteSettings, UpdateState } from "../types.js";

export function installDenoteApi(): void {
  window.denote = denoteApi;
}

const unavailableUpdateState: UpdateState = {
  status: "error",
  message: "Tauri updater is not configured for this build yet."
};

export const denoteApi: DenoteApi = {
  generateDraft(sourceText) {
    return invoke("generate_draft", { sourceText });
  },
  saveCard(card) {
    return invoke("save_card", { card });
  },
  deleteCard(id) {
    return invoke("delete_card", { id });
  },
  updateCardStatus(payload) {
    return invoke("update_card_status", { payload });
  },
  getAppInfo() {
    return invoke("get_app_info");
  },
  getUpdateState() {
    return invoke<UpdateState>("get_update_state").catch(() => unavailableUpdateState);
  },
  checkForUpdates() {
    return invoke<UpdateState>("check_for_updates").catch(() => unavailableUpdateState);
  },
  downloadUpdate() {
    return invoke<UpdateState>("download_update").catch(() => unavailableUpdateState);
  },
  installUpdate() {
    return invoke<UpdateState>("install_update").catch(() => unavailableUpdateState);
  },
  openExternal(url) {
    return invoke("open_external", { url });
  },
  onUpdateStateChanged(callback) {
    let active = true;
    void listen<UpdateState>("denote:updateStateChanged", (event) => {
      if (active) {
        callback(event.payload);
      }
    });
    return () => {
      active = false;
    };
  },
  onCardsChanged(callback) {
    let active = true;
    void listen<{ reason: string }>("denote:cardsChanged", (event) => {
      if (active) {
        callback(event.payload);
      }
    });
    return () => {
      active = false;
    };
  },
  listCards() {
    return invoke("list_cards");
  },
  ask(payload) {
    return invoke("ask", { payload });
  },
  getSettings() {
    return invoke("get_settings");
  },
  getDiagnostics() {
    return invoke("get_diagnostics");
  },
  saveSettings(settings: Partial<DenoteSettings>) {
    return invoke("save_settings", { settings });
  },
  testCloudflareSyncConnection(settings?: Partial<CloudflareSyncSettings>) {
    return invoke("test_cloudflare_sync_connection", { settings });
  },
  syncCloudflareNow(settings?: Partial<CloudflareSyncSettings>) {
    return invoke("sync_cloudflare_now", { settings });
  },
  seedSamples() {
    return invoke("seed_samples");
  }
};
