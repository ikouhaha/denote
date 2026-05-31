import { type CardStore } from "../storage/cardStore.js";
import { sampleCards } from "./sampleCards.js";

export async function ensureSampleCards(store: CardStore): Promise<{ added: number }> {
  const existing = await store.listCards();
  const existingTitles = new Set(existing.map((card) => card.title));
  let added = 0;

  for (const sample of sampleCards) {
    if (!existingTitles.has(sample.title)) {
      await store.saveCard(sample);
      added += 1;
    }
  }

  return { added };
}
