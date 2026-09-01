import { AxiError } from "axi-sdk-js";

/**
 * Split an argv token into its flag name and any inline `=value`, if present.
 */
function flagParts(arg: string): { name: string; value?: string } {
  if (arg.startsWith("--")) {
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      return { name: arg.slice(0, eq), value: arg.slice(eq + 1) };
    }
  }
  return { name: arg };
}

/** Return the value for --flag (space or = form) without removing it. */
export function getFlag(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const { name: n, value } = flagParts(args[i]);
    if (n === name) {
      return value !== undefined ? value : args[i + 1];
    }
  }
  return undefined;
}

/** Take and remove --flag value (space or = form); returns value or undefined. */
export function takeFlag(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const { name, value } = flagParts(args[i]);
    if (name === flag) {
      if (value !== undefined) {
        args.splice(i, 1);
        return value;
      }
      const val = args[i + 1];
      args.splice(i, 2);
      return val;
    }
  }
  return undefined;
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.some((a) => flagParts(a).name === flag);
}

/** True iff a boolean flag is present and not negated as `--no-<flag>`. */
export function takeBoolFlag(args: string[], flag: string): boolean {
  const i = args.findIndex((a) => flagParts(a).name === flag);
  if (i === -1) {
    return false;
  }
  args.splice(i, 1);
  return true;
}

export function getAllFlags(args: string[]): string[] {
  return args.filter((a) => a.startsWith("-")).map((a) => flagParts(a).name);
}

export function takeAllFlags(args: string[], flags: string[]): string[] {
  const found: string[] = [];
  for (let i = args.length - 1; i >= 0; i--) {
    const { name } = flagParts(args[i]);
    if (flags.includes(name)) {
      found.unshift(args.splice(i, 1)[0]!);
    }
  }
  return found;
}

export function pushRepeated(base: string[], flag: string, values: string[]): void {
  for (const v of values) {
    base.push(flag, v);
  }
}

/**
 * Return the first non-flag positional token at/after startIndex.
 * Skips `--` and token values that follow a flag.
 */
export function getPositional(args: string[], startIndex = 0): string | undefined {
  for (let i = startIndex; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--") {
      continue;
    }
    if (!a.startsWith("-")) {
      return a;
    }
  }
  return undefined;
}

export function requireNumber(raw: string | undefined, label: string): number {
  if (raw === undefined || raw === "" || Number.isNaN(Number(raw))) {
    throw new AxiError(
      `${label} must be a number`,
      "VALIDATION_ERROR",
    );
  }
  return Number(raw);
}

export function takeNumber(args: string[], label: string): number | undefined {
  const raw = takeFlag(args, label);
  if (raw === undefined) {
    return undefined;
  }
  return requireNumber(raw, label);
}

/** Throw VALIDATION_ERROR if a flag needs a value but none is present. */
export function requireFlagValue(value: string | undefined, flag: string): string {
  if (value === undefined || value === "") {
    throw new AxiError(
      `${flag} requires a value`,
      "VALIDATION_ERROR",
    );
  }
  return value;
}
