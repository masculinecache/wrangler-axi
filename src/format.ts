export interface CountLineOptions {
  count: number;
  limit?: number;
  totalCount?: number;
  apiLimitHit?: boolean;
  displayLimit?: number;
}

/**
 * Render a definitive `count:` line satisfying AXI's pre-computed aggregate +
 * definitive empty state principles. All diagnostics (totals, truncation, api
 * limits) are folded into the single line so agents don't paginate blindly.
 */
export function formatCountLine(opts: CountLineOptions): string {
  const { count, limit, totalCount, apiLimitHit, displayLimit } = opts;
  if (apiLimitHit) {
    return `count: ${count}+ (api limit reached)`;
  }
  if (totalCount !== undefined && totalCount >= count) {
    return `count: ${count} of ${totalCount} total`;
  }
  if (displayLimit !== undefined && count > displayLimit) {
    return `count: ${count} (showing first ${displayLimit})`;
  }
  if (limit !== undefined && count === limit && count > 0) {
    return `count: ${count} (showing first ${count})`;
  }
  return `count: ${count}`;
}
