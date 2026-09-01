import { encode } from "@toon-format/toon";

export { encode };

function formatRelativeTime(iso: string): string {
  if (!iso) {
    return "unknown";
  }
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return "unknown";
  }
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 60) {
    return "just now";
  }
  const min = Math.floor(diffSec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hour = Math.floor(min / 60);
  if (hour < 24) {
    return `${hour}h ago`;
  }
  const day = Math.floor(hour / 24);
  if (day < 30) {
    return `${day}d ago`;
  }
  const month = Math.floor(day / 30);
  if (month < 12) {
    return `${month}mo ago`;
  }
  return `${Math.floor(month / 12)}y ago`;
}

export interface FieldDef {
  render: (item: any) => any;
  as?: string;
}

/** Schema maps an output key to a renderer. Item is passed as `any`. */
export interface Schema {
  [outputKey: string]: FieldDef;
}

type RecordItem = Record<string, any>;

function rec(item: any): RecordItem {
  return (item ?? {}) as RecordItem;
}

/** Simple field extracted directly from the item, optionally renamed. */
export function field(key: string, as?: string): FieldDef {
  return {
    render: (item) => rec(item)[key] ?? null,
    ...(as ? { as } : {}),
  };
}

/** Nested field: item[key][subkey]. */
export function pluck(key: string, subkey: string, as?: string): FieldDef {
  return {
    render: (item) => {
      const val = rec(item)[key];
      if (val && typeof val === "object") {
        return rec(val)[subkey] ?? null;
      }
      return null;
    },
    ...(as ? { as } : {}),
  };
}

/** Join an array field into a comma-separated string (or empty string). */
export function joinArray(
  key: string,
  subkey: string,
  as?: string,
  empty = "none",
): FieldDef {
  return {
    render: (item) => {
      const val = rec(item)[key];
      if (!Array.isArray(val) || val.length === 0) {
        return empty;
      }
      return val
        .map((x) => (typeof x === "string" ? x : rec(x)[subkey]))
        .filter(Boolean)
        .join(",");
    },
    ...(as ? { as } : {}),
  };
}

/** ISO timestamp formatted as relative human time. */
export function relativeTime(key: string, as?: string): FieldDef {
  return {
    render: (item) => {
      const iso = rec(item)[key];
      return typeof iso === "string" ? formatRelativeTime(iso) : "unknown";
    },
    ...(as ? { as } : {}),
  };
}

export function boolYesNo(key: string, as?: string): FieldDef {
  return {
    render: (item) => (rec(item)[key] ? "yes" : "no"),
    ...(as ? { as } : {}),
  };
}

export function mapEnum(
  key: string,
  map: Record<string, string>,
  fallback?: string,
  as?: string,
): FieldDef {
  return {
    render: (item) => {
      const val = rec(item)[key];
      const str = val == null ? undefined : String(val);
      if (str !== undefined && Object.prototype.hasOwnProperty.call(map, str)) {
        return map[str];
      }
      return fallback ?? str ?? "none";
    },
    ...(as ? { as } : {}),
  };
}

export function lower(key: string, as?: string): FieldDef {
  return {
    render: (item) => {
      const v = rec(item)[key];
      return typeof v === "string" ? v.toLowerCase() : v ?? null;
    },
    ...(as ? { as } : {}),
  };
}

export function checksSummary(key: string, as?: string): FieldDef {
  return {
    render: (item) => {
      const checks = rec(item)[key];
      if (!Array.isArray(checks)) {
        return "none";
      }
      const passed = checks.filter(
        (c) =>
          rec(c).conclusion === "SUCCESS" ||
          rec(c).conclusion === "NEUTRAL",
      ).length;
      return `${passed}/${checks.length} pass`;
    },
    ...(as ? { as } : {}),
  };
}

export function custom(fn: (item: any) => any, as?: string): FieldDef {
  return {
    render: fn,
    ...(as ? { as } : {}),
  };
}

/** Map an item through a schema into a plain object of outputKey -> rendered value. */
export function extract(item: any, schema: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [label, def] of Object.entries(schema)) {
    out[label] = def.render(item);
  }
  return out;
}

export function renderList(label: string, items: unknown[], schema: Schema): string {
  return encode({ [label]: items.map((i) => extract(i, schema)) });
}

export function renderDetail(label: string, item: unknown, schema: Schema): string {
  return encode({ [label]: extract(item, schema) });
}

export function renderHelp(lines: string[]): string {
  if (lines.length === 0) {
    return "";
  }
  return `help[${lines.length}]:\n${lines.map((l) => `  ${l}`).join("\n")}`;
}

export function renderError(
  message: string,
  code: string,
  suggestions: string[] = [],
): string {
  const err = encode({ error: message, code });
  if (suggestions.length > 0) {
    return `${err}\n${renderHelp(suggestions)}`;
  }
  return err;
}

export function renderOutput(blocks: Array<string | undefined>): string {
  return blocks.filter(Boolean).join("\n");
}
