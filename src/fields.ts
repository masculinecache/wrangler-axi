import { AxiError } from "axi-sdk-js";
import type { FieldDef } from "./toon.js";

export interface AvailableField {
  def?: FieldDef;
  key?: string;
}

/**
 * Validate a comma-separated --fields argument against a map of known fields.
 * Unknown fields fail loudly (VALIDATION_ERROR, exit 2).
 */
export function parseFields(
  fieldsArg: string | undefined,
  available: Record<string, AvailableField>,
): { extraDefs: [string, FieldDef][]; extraKeys: string[] } {
  if (fieldsArg === undefined) {
    return { extraDefs: [], extraKeys: [] };
  }
  const names = [...new Set(fieldsArg.split(",").map((s) => s.trim()).filter(Boolean))];
  const unknown = names.filter((n) => !(n in available));
  if (unknown.length > 0) {
    throw new AxiError(
      `Unknown field(s): ${unknown.join(", ")}. Available: ${Object.keys(
        available,
      )
        .sort()
        .join(", ")}`,
      "VALIDATION_ERROR",
    );
  }
  const extraDefs: [string, FieldDef][] = [];
  const extraKeys: string[] = [];
  for (const name of names) {
    if (available[name]!.def) {
      extraDefs.push([name, available[name]!.def!]);
    }
    if (available[name]!.key) {
      extraKeys.push(available[name]!.key!);
    }
  }
  return { extraDefs, extraKeys };
}

/** Merge extra defs into a base schema (returning a new object). */
export function addExtraDefs(
  base: Record<string, FieldDef>,
  extra: [string, FieldDef][],
): Record<string, FieldDef> {
  const merged: Record<string, FieldDef> = { ...base };
  for (const [name, def] of extra) {
    merged[name] = def;
  }
  return merged;
}
