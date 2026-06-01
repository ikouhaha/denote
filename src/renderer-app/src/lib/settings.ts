import type { DenoteSettings, NotionTaskSource, NotionTokenProfile } from "../types.js";

export function normalizeNotionTaskSources(input: unknown, legacySourceId = ""): NotionTaskSource[] {
  const sources = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const normalized: NotionTaskSource[] = [];
  for (const source of sources) {
    const record = source as Partial<NotionTaskSource>;
    const id = String(record?.id || "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push({
      id,
      name: String(record?.name || "").trim() || id,
      enabled: record?.enabled !== false,
      url: String(record?.url || "").trim()
    });
  }
  const legacyId = String(legacySourceId || "").trim();
  if (legacyId && normalized.length === 0 && !seen.has(legacyId)) {
    normalized.push({ id: legacyId, name: legacyId, enabled: true });
  }
  return normalized;
}

export function normalizeNotionTokens(settings: Partial<DenoteSettings>): NotionTokenProfile[] {
  const input = settings.notionTokens || settings.notionWorkspaces || [];
  const profiles = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const normalized: NotionTokenProfile[] = [];
  for (const profile of profiles) {
    const id = String(profile?.id || "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push({
      id,
      name: String(profile?.name || "").trim() || id,
      token: String(profile?.token || "").trim(),
      taskSources: normalizeNotionTaskSources(profile?.taskSources)
    });
  }

  const legacyToken = String(settings.notionToken || "").trim();
  if (normalized.length === 0 && legacyToken) {
    normalized.push({
      id: "notion-token-1",
      name: "Notion token 1",
      token: legacyToken,
      taskSources: normalizeNotionTaskSources(settings.notionTaskSources, settings.notionTasksDatabaseId)
    });
  }
  return normalized;
}

export function formatNotionTokenOptionLabel(profile: NotionTokenProfile): string {
  const suffix = profile.id ? profile.id.slice(-4) : "";
  return suffix ? `${profile.name || profile.id} (${suffix})` : profile.name || profile.id;
}

export function getActiveNotionToken(tokens: NotionTokenProfile[], activeId: string): NotionTokenProfile | null {
  return tokens.find((profile) => profile.id === activeId) || tokens[0] || null;
}
