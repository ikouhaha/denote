import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { type ContentType, normalizeTags } from "../cards/schemas.js";

export type SavedCard = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  content_type: ContentType;
  source_text: string;
  created_at: string;
  updated_at: string;
};

export type SaveCardInput = {
  id?: string;
  title: string;
  summary: string;
  tags: string[];
  content_type: ContentType;
  source_text: string;
};

type StoreFile = {
  cards: SavedCard[];
};

export class CardStore {
  private readonly filePath: string;

  constructor(private readonly dataDir: string) {
    this.filePath = join(dataDir, "cards.json");
  }

  async listCards(): Promise<SavedCard[]> {
    const store = await this.readStore();
    return [...store.cards].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async saveCard(input: SaveCardInput): Promise<SavedCard> {
    const now = new Date().toISOString();
    const store = await this.readStore();
    const existingIndex = input.id ? store.cards.findIndex((card) => card.id === input.id) : -1;
    const existing = existingIndex >= 0 ? store.cards[existingIndex] : undefined;

    const card: SavedCard = {
      id: input.id ?? randomUUID(),
      title: input.title.trim(),
      summary: input.summary.trim(),
      tags: normalizeTags(input.tags),
      content_type: input.content_type,
      source_text: input.source_text.trim(),
      created_at: existing?.created_at ?? now,
      updated_at: now
    };

    if (!card.title || !card.summary || !card.source_text) {
      throw new Error("Card title, summary, and source text are required");
    }

    if (existingIndex >= 0) {
      store.cards[existingIndex] = card;
    } else {
      store.cards.push(card);
    }

    await this.writeStore(store);
    return card;
  }

  async deleteCard(id: string): Promise<{ deleted: boolean }> {
    const store = await this.readStore();
    const nextCards = store.cards.filter((card) => card.id !== id);

    if (nextCards.length === store.cards.length) {
      return { deleted: false };
    }

    await this.writeStore({ cards: nextCards });
    return { deleted: true };
  }

  private async readStore(): Promise<StoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoreFile;
      return { cards: Array.isArray(parsed.cards) ? parsed.cards : [] };
    } catch (error) {
      if (isNotFoundError(error)) {
        return { cards: [] };
      }
      throw error;
    }
  }

  private async writeStore(store: StoreFile): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(store, null, 2), "utf8");
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}
