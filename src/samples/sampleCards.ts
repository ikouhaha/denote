import { type SaveCardInput } from "../storage/cardStore.js";

export const sampleCards: SaveCardInput[] = [
  {
    title: "Denote retrieval strategy",
    summary: "Denote should use hybrid retrieval so exact terms and semantic meaning both matter.",
    tags: ["denote", "rag", "retrieval"],
    content_type: "technical_note",
    source_text:
      "Denote retrieval should combine keyword search with vector search. Keyword search catches exact terms like SQLite, MCP, vendor codes, and model names. Vector search helps with semantic questions. Answers should cite source excerpts so users can trust where the answer came from."
  },
  {
    title: "Local-first storage boundary",
    summary: "SQLite should be the source of truth while vector indexes remain rebuildable.",
    tags: ["sqlite", "lancedb", "local-first"],
    content_type: "technical_note",
    source_text:
      "Denote is local-first in storage. SQLite should store cards, chunks, tags, projects, provider settings, and index jobs. LanceDB can store vectors, but it must be rebuildable from SQLite because derived indexes can drift or fail."
  },
  {
    title: "MCP and mobile are future adapters",
    summary: "MCP and mobile relay should wrap BrainEngine later, not distort the MVP.",
    tags: ["mcp", "mobile", "architecture"],
    content_type: "project_note",
    source_text:
      "Future MCP support should be an adapter around BrainEngine operations such as search, add, and ask. Mobile access should avoid public port forwarding and can use a relay pattern later. The MVP should validate desktop local knowledge first."
  }
];
