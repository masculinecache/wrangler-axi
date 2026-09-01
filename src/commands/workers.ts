import type { CommandArea, CommandContext } from "../cli.js";
import { callWrangler, parseJson } from "../wrangler.js";
import { takeAllFlags, takeFlag, takeNumber, getPositional, pushRepeated } from "../args.js";
import { validateFlags, wantsHelp } from "../util.js";
import { formatCountLine } from "../format.js";
import { AxiError, mapWranglerError } from "../errors.js";
import {
  addExtraDefs,
  parseFields,
  type AvailableField,
} from "../fields.js";
import {
  custom,
  field,
  relativeTime,
  pluck,
  renderDetail,
  renderHelp,
  renderList,
  renderOutput,
} from "../toon.js";
import { renderListBlock } from "../list.js";

interface Version {
  id: string;
  created_on?: string;
  modified_on?: string;
  deployment_id?: string;
  resources?: { script?: { etag?: string } };
  config?: unknown;
}

interface Deployment {
  id: string;
  url?: string;
  created_on?: string;
  modified_on?: string;
  date?: string;
  version_id?: string;
  deployment_id?: string;
  author_email?: string;
  source?: { type?: string };
}

const versionsAvailable: Record<string, AvailableField> = {
  modified: { def: relativeTime("modified_on", "modified") },
  deployment: { def: pluck("resources", "script", "deployment") },
};

const deploymentsAvailable: Record<string, AvailableField> = {
  modified: { def: relativeTime("modified_on", "modified") },
  source: { def: pluck("source", "type", "source") },
};

const DEPLOY_FLAGS = [
  "--name", "--tag", "--message", "--no-bundle", "--outdir", "--outfile",
  "--compatibility-date", "--compatibility-flags", "--latest", "--assets",
  "--var", "--define", "--alias", "--tsconfig", "--minify", "--dry-run",
  "--secrets-file", "--keep-vars", "--strict", "--triggers", "--routes",
  "--domains", "--dispatch-namespace", "--autoconfig", "--json", "--full",
];

/** Pass-through filter flags for `wrangler tail` (single-valued). */
const TAIL_VALUE_FLAGS = ["--search", "--sampling-rate", "--version-id"];

/** Pass-through filter flags for `wrangler tail` (repeatable). */
const TAIL_ARRAY_FLAGS = ["--status", "--method", "--ip", "--header"];

/** Our own control flags on top of the wrangler filters. */
const TAIL_VALID_FLAGS = [
  "--max-entries", "--timeout", "--json", "--full",
  ...TAIL_VALUE_FLAGS,
  ...TAIL_ARRAY_FLAGS,
];

interface TailRow {
  event: string;
  outcome: string;
  summary: string;
}

export const workersCommand: CommandArea = {
  name: "workers",
  aliases: ["worker"],
  description: "manage Workers (deploy, versions, deployments, tail)",
  help: [
    "Usage: wrangler-axi workers <deploy|versions|deployments|tail> [args]",
    "  deploy       — deploy a Worker (mutating)",
    "  versions     — list/upload versioned deployments",
    "  deployments  — list recent deployments",
    "  tail         — stream bounded live logs (stops at --max-entries or --timeout)",
    "Example: wrangler-axi workers deployments list --name my-worker",
  ],
  async run(ctx: CommandContext, args: string[]) {
    const sub = args[0];
    if (sub === undefined) {
      return { stdout: renderHelp(workersCommand.help), exitCode: 0 };
    }
    if (sub.startsWith("-")) {
      return { stdout: renderHelp(workersCommand.help), exitCode: 0 };
    }
    const rest = args.slice(1);
    switch (sub) {
      case "deploy":
        return deploy(ctx, rest);
      case "versions":
        return versions(ctx, rest);
      case "deployments":
        return deployments(ctx, rest);
      case "tail":
        return tail(ctx, rest);
      default:
        const validSubcommands = ["deploy", "versions", "deployments", "tail"];
        throw new AxiError(
          `Unknown workers subcommand "${sub}". Valid subcommands are: ${validSubcommands.join(", ")}`,
          "VALIDATION_ERROR",
        );
    }
  },
};

async function deploy(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi workers deploy [path] [--name <worker>] [flags]",
        "Deploys a Worker. Mirrors wrangler deploy; pass through flags like --compatibility-date, --var, --minify, --full.",
        "Use --dry-run to preview without deploying.",
      ]),
      exitCode: 0,
    };
  }
  const userJson = takeAllFlags(args, ["--json"]).length > 0;
  const full = takeAllFlags(args, ["--full"]).length > 0;
  validateFlags(args, DEPLOY_FLAGS, "workers deploy");
  const wArgs = ["deploy"];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  // Pass through single-value flags verbatim BEFORE extracting the positional path.
  for (const f of ["--name", "--tag", "--message", "--compatibility-date", "--assets", "--outdir", "--outfile", "--tsconfig", "--secrets-file", "--dispatch-namespace"]) {
    const v = takeFlag(args, f);
    if (v !== undefined) {
      wArgs.push(f, v);
    }
  }
  // Pass through repeatable flags (space or = form).
  let aliasOut = "";
  for (const f of ["--compatibility-flags", "--var", "--define", "--alias", "--routes", "--domains", "--triggers"]) {
    const values = extractRepeatable(args, f);
    if (values.length > 0) {
      pushRepeated(wArgs, f, values);
      if (f === "--alias") {
        aliasOut = values.join(", ");
      }
    }
  }
  // Pass through boolean flags.
  for (const f of ["--no-bundle", "--latest", "--minify", "--dry-run", "--keep-vars", "--strict", "--autoconfig"]) {
    if (takeAllFlags(args, [f]).length > 0) {
      wArgs.push(f);
    }
  }
  const path = args.filter((a) => !a.startsWith("-"))[0];
  if (path) {
    wArgs.push(path);
  }
  // Add --json to get structured output
  wArgs.push("--json");

  const { stdout } = await callWrangler(ctx.runner, wArgs);
  let version = "";
  let url = "";

  try {
    const json = JSON.parse(stdout);
    // Assuming the structure: { result: { id: "...", deployment: { url: "..." } } }
    if (json.result && json.result.id) {
      version = json.result.id;
    }
    if (json.result && json.result.deployment && json.result.deployment.url) {
      url = json.result.deployment.url;
    }
  } catch {
    // If parsing fails, we leave version and url empty
  }

  if (userJson) {
    return { stdout, exitCode: 0 };
  }

  return {
    stdout: renderDetail(
      "deploy",
      { path: path ?? "(config)", status: "deployed", version, url, alias: aliasOut },
      {
        path: custom((d: { path: string }) => d.path),
        status: custom((d: { status: string }) => d.status),
        version: custom((d: { version: string }) => d.version),
        url: custom((d: { url: string }) => d.url),
        alias: custom((d: { alias: string }) => d.alias),
        output: custom(() => {
          const truncated = truncateTail(stdout.trim(), 120, full);
          return truncated || "(no output)";
        }),
      },
    ),
    exitCode: 0,
  };
}

function extractRepeatable(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === flag || a.startsWith(`${flag}=`)) {
      if (a.startsWith(`${flag}=`)) {
        values.push(a.slice(flag.length + 1));
        args.splice(i, 1);
        i--;
      } else {
        const v = args[i + 1];
        if (v !== undefined && !v.startsWith("-")) {
          values.push(v);
          args.splice(i, 2);
          i--;
        } else {
          args.splice(i, 1);
          i--;
        }
      }
    }
  }
  return values;
}

async function versions(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi workers versions list [--name <worker>]",
        "Flags: --name <worker>, --fields, --limit <n> (default 20), --full, --json",
      ]),
      exitCode: 0,
    };
  }
  const sub = args[0];
  if (sub !== undefined && sub !== "list" && !sub.startsWith("-")) {
    throw new AxiError(`Unknown versions subcommand "${sub}"`, "VALIDATION_ERROR", [
      "Run `wrangler-axi workers versions --help` for valid subcommands",
    ]);
  }
  const listArgs = sub === "list" ? args.slice(1) : args;
  const json = takeAllFlags(listArgs, ["--json"]).length > 0;
  const full = takeAllFlags(listArgs, ["--full"]).length > 0;
  validateFlags(listArgs, ["--name", "--fields", "--limit", "--full", "--json"], "workers versions list");
  const wArgs = ["versions", "list", "--json"];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  const worker = takeFlag(listArgs, "--name");
  if (worker) {
    wArgs.push("--name", worker);
  }
  const limit = full ? undefined : (takeNumber(listArgs, "--limit") ?? 20);
  const fieldsArg = takeFlag(listArgs, "--fields");

  const { stdout } = await callWrangler(ctx.runner, wArgs);
  if (json) {
    return { stdout, exitCode: 0 };
  }
  const items = parseJson<Version[]>(stdout, "versions");
  const { extraDefs } = parseFields(fieldsArg, versionsAvailable);
  const schema = addExtraDefs(
    {
      id: field("id"),
      created: relativeTime("created_on", "created"),
    },
    extraDefs,
  );
  return {
    stdout: renderListBlock({
      noun: "versions",
      items,
      schema,
      limit,
      empty: "versions: no versions found for this worker",
      truncatedHint: "Run `wrangler-axi workers versions list --json` for the full set wrangler returns",
    }),
    exitCode: 0,
  };
}

async function deployments(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi workers deployments list [--name <worker>]",
        "Flags: --name <worker>, --fields, --limit <n> (default 20), --full, --json",
        "Note: wrangler caps this list to the 10 most recent deployments.",
      ]),
      exitCode: 0,
    };
  }
  const sub = args[0];
  if (sub !== undefined && sub !== "list" && !sub.startsWith("-")) {
    throw new AxiError(`Unknown deployments subcommand "${sub}"`, "VALIDATION_ERROR", [
      "Run `wrangler-axi workers deployments --help` for valid subcommands",
    ]);
  }
  const listArgs = sub === "list" ? args.slice(1) : args;
  const json = takeAllFlags(listArgs, ["--json"]).length > 0;
  const full = takeAllFlags(listArgs, ["--full"]).length > 0;
  validateFlags(listArgs, ["--name", "--fields", "--limit", "--full", "--json"], "workers deployments list");
  const wArgs = ["deployments", "list", "--json"];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  const worker = takeFlag(listArgs, "--name");
  if (worker) {
    wArgs.push("--name", worker);
  }
  const limit = full ? undefined : (takeNumber(listArgs, "--limit") ?? 20);
  const fieldsArg = takeFlag(listArgs, "--fields");

  const { stdout } = await callWrangler(ctx.runner, wArgs);
  if (json) {
    return { stdout, exitCode: 0 };
  }
  const items = parseJson<Deployment[]>(stdout, "deployments");
  const { extraDefs } = parseFields(fieldsArg, deploymentsAvailable);
  const schema = addExtraDefs(
    {
      id: field("id"),
      url: field("url"),
      created: relativeTime("created_on", "created"),
    },
    extraDefs,
  );
  return {
    stdout: renderListBlock({
      noun: "deployments",
      items,
      schema,
      limit,
      empty: "deployments: no deployments found",
      truncatedHint: "Run `wrangler-axi workers deployments list --json` for the full set wrangler returns",
    }),
    exitCode: 0,
  };
}

/** Truncate a summary value to a readable width, noting how much was cut. */
function truncateTail(raw: string, max = 120, full = false): string {
  if (full || raw.length <= max) {
    return raw;
  }
  const cut = raw.length - max;
  return `${raw.slice(0, max)}\u2026 (+${cut} more)`;
}

interface RawTailEvent {
  event?: {
    type?: string;
    outcome?: string;
    request?: { method?: string; url?: string };
    message?: string;
    exception?: { name?: string; message?: string };
    error?: { name?: string; message?: string };
  };
  eventType?: string;
  outcome?: string;
  scriptName?: string;
}

/** Parse one raw `wrangler tail --format json` line into a compact row. */
function parseTailLine(line: string, full: boolean): TailRow {
  let parsed: RawTailEvent;
  try {
    parsed = JSON.parse(line) as RawTailEvent;
  } catch {
    return {
      event: "raw",
      outcome: "unknown",
      summary: truncateTail(line, 120, full),
    };
  }
  const ev = parsed.event ?? {};
  const type = ev.type ?? parsed.eventType ?? "unknown";
  const outcome = ev.outcome ?? parsed.outcome ?? "unknown";
  if (type === "request" && ev.request) {
    const method = ev.request.method ?? "?";
    const url = ev.request.url ?? "";
    return { event: type, outcome, summary: truncateTail(`${method} ${url}`, 120, full) };
  }
  const exc = ev.exception ?? ev.error;
  if (exc) {
    return {
      event: type,
      outcome,
      summary: truncateTail(`${exc.name ?? "error"}: ${exc.message ?? ""}`, 120, full),
    };
  }
  if (ev.message) {
    return { event: type, outcome, summary: truncateTail(ev.message, 120, full) };
  }
  return { event: type, outcome, summary: truncateTail(line, 120, full) };
}

/** Stopped-by size hint, so agents know the stream was bounded and how to widen it. */
function tailStopHint(result: {
  stoppedBy: "limit" | "timeout" | "exit";
  maxEntries: number;
  timeoutSec: number;
  exitCode: number;
  captured: number;
}): string {
  if (result.stoppedBy === "limit") {
    return `captured ${result.captured} entries (stopped at --max-entries ${result.maxEntries}); raise --max-entries to keep streaming`;
  }
  if (result.stoppedBy === "timeout") {
    return `stopped after ${result.timeoutSec}s (--timeout) before --max-entries; raise --timeout to sample longer`;
  }
  return `stream ended (exit ${result.exitCode}) before limits — retry, or use --status to filter`;
}

async function tail(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi workers tail [worker] [flags]",
        "Streams live Worker logs with a hard bound: stops at --max-entries or --timeout.",
        `Flags: --max-entries <n> (default 20), --timeout <sec> (default 15), --json (raw lines), --full (disable truncation)`,
        `Filters (passed through): ${TAIL_VALUE_FLAGS.join(", ")}, ${TAIL_ARRAY_FLAGS.join(", ")}`,
        "Example: wrangler-axi workers tail my-worker --search \"error\" --status error --max-entries 5",
      ]),
      exitCode: 0,
    };
  }
  validateFlags(args, TAIL_VALID_FLAGS, "workers tail");
  const json = takeAllFlags(args, ["--json"]).length > 0;
  const full = takeAllFlags(args, ["--full"]).length > 0;

  let maxEntries = takeNumber(args, "--max-entries");
  if (maxEntries === undefined) {
    maxEntries = 20;
  } else if (!Number.isInteger(maxEntries)) {
    throw new AxiError(
      "--max-entries must be an integer",
      "VALIDATION_ERROR",
    );
  }
  let timeoutSec = takeNumber(args, "--timeout");
  if (timeoutSec === undefined) {
    timeoutSec = 15;
  } else if (!Number.isInteger(timeoutSec)) {
    throw new AxiError(
      "--timeout must be an integer",
      "VALIDATION_ERROR",
    );
  }
  if (maxEntries <= 0 && timeoutSec <= 0) {
    throw new AxiError(
      "workers tail needs a bound — set --max-entries > 0 or --timeout > 0",
      "VALIDATION_ERROR",
    );
  }

  const wArgs = ["tail", "--format", "json"];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  for (const f of TAIL_VALUE_FLAGS) {
    const v = takeFlag(args, f);
    if (v !== undefined) {
      wArgs.push(f, v);
    }
  }
  for (const f of TAIL_ARRAY_FLAGS) {
    const values = extractRepeatable(args, f);
    if (values.length > 0) {
      pushRepeated(wArgs, f, values);
    }
  }
  const worker = getPositional(args);
  if (worker) {
    wArgs.push(worker);
  }

  const tailFn = ctx.runner.tail;
  if (!tailFn) {
    throw new AxiError(
      "workers tail requires a runner with streaming support",
      "UNKNOWN",
    );
  }
  const result = await tailFn({
    args: wArgs,
    maxEntries,
    timeoutMs: timeoutSec * 1000,
  });

  if (result.exitCode !== 0 && result.stoppedBy === "exit") {
    throw mapWranglerError(result.stderr, result.exitCode);
  }

  if (json) {
    return {
      stdout: result.entries.length > 0 ? result.entries.join("\n") : "",
      exitCode: 0,
    };
  }

  const rows = result.entries.map((line) => parseTailLine(line, full));
  const schema = {
    event: field("event"),
    outcome: field("outcome"),
    summary: field("summary"),
  };
  if (rows.length === 0) {
    const hint = `no log events in ${timeoutSec}s — the worker may have no traffic`;
    return {
      stdout: renderOutput([
        formatCountLine({ count: 0, limit: maxEntries > 0 ? maxEntries : undefined }),
        `tail: ${hint}`,
      ]),
      exitCode: 0,
    };
  }
  return {
    stdout: renderOutput([
      formatCountLine({ count: rows.length, limit: maxEntries > 0 ? maxEntries : undefined }),
      renderList(`tail[${rows.length}]`, rows, schema),
      renderHelp([tailStopHint({ ...result, maxEntries, timeoutSec, captured: rows.length })]),
    ]),
    exitCode: 0,
  };
}
