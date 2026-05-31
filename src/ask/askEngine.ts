import { type SavedCard } from "../storage/cardStore.js";

export type AskSource = {
  card_id: string;
  title: string;
  excerpt: string;
};

export type AskAnswer =
  | {
      status: "answered";
      text: string;
      sources: AskSource[];
    }
  | {
      status: "insufficient_evidence";
      text: string;
      sources: [];
    };

const STOP_WORDS = new Set([
  "about",
  "does",
  "from",
  "how",
  "should",
  "the",
  "this",
  "what",
  "when",
  "where",
  "with",
  "work"
]);

export function answerFromCards(question: string, cards: SavedCard[]): AskAnswer {
  const queryTerms = tokenize(question).filter((term) => !STOP_WORDS.has(term));
  if (queryTerms.length === 0) {
    return insufficientAnswer();
  }

  const ranked = cards
    .map((card) => ({ card, score: scoreCard(queryTerms, card) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.card.title.localeCompare(b.card.title));

  const best = ranked[0]?.card;
  if (!best) {
    return insufficientAnswer();
  }

  const excerpt = selectExcerpt(queryTerms, best.source_text);
  return {
    status: "answered",
    text: `${best.title}: ${best.summary}`,
    sources: [
      {
        card_id: best.id,
        title: best.title,
        excerpt
      }
    ]
  };
}

function insufficientAnswer(): AskAnswer {
  return {
    status: "insufficient_evidence",
    text: "I do not have enough saved Denote knowledge to answer that yet.",
    sources: []
  };
}

function scoreCard(queryTerms: string[], card: SavedCard): number {
  const haystack = `${card.title} ${card.summary} ${card.tags.join(" ")} ${card.source_text}`.toLowerCase();
  return queryTerms.reduce((score, term) => {
    return haystack.includes(term) ? score + 1 : score;
  }, 0);
}

function selectExcerpt(queryTerms: string[], sourceText: string): string {
  const sentences = sourceText.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [sourceText];
  const scored = sentences
    .map((sentence) => ({
      sentence: sentence.trim(),
      score: queryTerms.reduce((score, term) => {
        return sentence.toLowerCase().includes(term) ? score + 1 : score;
      }, 0)
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) {
    return sourceText.trim();
  }

  const bestIndex = sentences.findIndex((sentence) => sentence.trim() === best.sentence);
  const nextSentence = sentences[bestIndex + 1]?.trim();
  if (nextSentence) {
    return `${best.sentence} ${nextSentence}`.trim();
  }

  return best.sentence;
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
}
