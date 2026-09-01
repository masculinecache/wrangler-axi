import { formatCountLine } from "./format.js";
import { renderHelp, renderList, type Schema } from "./toon.js";

export interface ListBlockOptions {
  noun: string;
  items: unknown[];
  schema: Schema;
  limit?: number;
  /** totalCount shown in the count line when it differs from items.length. */
  totalCount?: number;
  empty: string;
  truncatedHint?: string;
}

/**
 * Render a definitive list block: aggregate count line, item list (respecting a
 * display limit), a definitive empty state, and a truncated-list hint. This is
 * the single place every `--limit` list renders, keeping empty/truncated output
 * consistent across commands.
 */
export function renderListBlock(opts: ListBlockOptions): string {
  const { noun, items, schema, limit, totalCount, empty, truncatedHint } = opts;
  const display = limit !== undefined ? items.slice(0, limit) : items;
  const total = totalCount ?? items.length;
  const countLine = formatCountLine({ count: total, limit, displayLimit: display.length });
  if (items.length === 0) {
    return [countLine, empty].filter(Boolean).join("\n");
  }
  const blocks: string[] = [countLine];
  blocks.push(renderList(`${noun}[${display.length}]`, display, schema));
  if (truncatedHint && limit !== undefined && items.length > limit) {
    blocks.push(renderHelp([truncatedHint]));
  }
  return blocks.filter(Boolean).join("\n");
}
