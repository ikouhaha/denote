import { type SaveCardInput } from "../storage/cardStore.js";

export const sampleCards: SaveCardInput[] = [
  {
    title: "QVAT support case: wholesale invoice mismatch",
    summary: "When a wholesale order is closed but the pending header is missing, rebuild the OS invoice source for the target invoice and rerun extraction before marking it manual.",
    project: "QVAT",
    tags: ["qvat", "support-case", "wholesale", "invoice"],
    content_type: "reference",
    source_text:
      "Support case: wholesale invoice mismatch. If order status is close, rebuild QVAT_AR_OS_INVOICE_SOURCE for the specified invoice number, run SP_EXTRACT_OS_INVOICES before deleting unfinished records, then update QVAT_AR_OS_PENDING_HEADER so DATA_SOURCE is MANUAL for that invoice. Final check: QVAT_AR_OS_PENDING_HEADER should contain the invoice."
  },
  {
    title: "QVAT support case: RPT08 amount mismatch",
    summary: "For RPT08 special invoice amount mismatches, compare grouping dates because the user may have downloaded only one grouping date.",
    project: "QVAT",
    tags: ["qvat", "support-case", "rpt08", "invoice"],
    content_type: "reference",
    source_text:
      "Support case: RPT08 special invoice amount differs from the actual issued invoice amount. First inspect QVAT_INTERNAL_SOURCE_DATA_RETOUCH GROUPING_DATETIME. There may be multiple grouping dates while the user downloaded only one date. Sum TOTAL_AMOUNT_WITH_MARKUP, row count, discount amount, and discount VAT amount over the relevant GROUPING_DATETIME range to reconcile the report total."
  },
  {
    title: "QVAT support case: JE regeneration",
    summary: "If a generated JE record used an amount-difference rule incorrectly, regenerate before Oracle upload and avoid generating JE for unmatched rows.",
    project: "QVAT",
    tags: ["qvat", "support-case", "je", "oracle"],
    content_type: "reference",
    source_text:
      "Support case: QVAT JE has an error and needs regeneration. The generated JE record may have used AMOUNT DIFFERENCE and a 5-series rule. If the JE has not been uploaded to Oracle, set the relevant generated flag before unmatch, or regenerate JE after unmatch. Unmatched JE rows should not be generated. The support procedure referenced is SP_QVAT_SUPPORT_REGEN_JE."
  },
  {
    title: "QVAT support case: wholesale manual split",
    summary: "For manual wholesale invoice split, stage split rows, execute the split support procedure, then reconcile header and group totals before committing.",
    project: "QVAT",
    tags: ["qvat", "support-case", "wholesale", "split"],
    content_type: "reference",
    source_text:
      "Support case: wholesale manual split invoice. Inspect QVAT_INTERNAL_INVOICE_PENDING and QVAT_INTERNAL_SOURCE_DATA_GROUP for the request batch. Clear related Bawang detail/header rows for the pending invoice, stage split quantities in QVAT_SPLIT_RED_INVOICE, then execute SP_QVAT_SUPPORT_SPLIT_WHOLESALE_PENDING_INVOICE. Check SUM(TOTAL_AMOUNT_WITH_MARKUP), COUNT, TOTAL_TAX_AMOUNT, and VAT_AMOUNT_ROUNDED across original and new headers/groups. If only tax or markup differs by a small rounding amount, adjust the affected group before commit."
  }
];
