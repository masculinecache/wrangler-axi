import { AxiError, exitCodeForError } from "./errors.js";
import { realRunner, type WranglerRunner } from "./wrangler.js";
import { renderError, renderHelp, renderOutput } from "./toon.js";
import { VERSION } from "./version.js";

import { whoamiCommand } from "./commands/whoami.js";
import { workersCommand } from "./commands/workers.js";
import { secretsCommand } from "./commands/secrets.js";
import { kvCommand } from "./commands/kv.js";
import { d1Command } from "./commands/d1.js";
import { r2Command } from "./commands/r2.js";
import { pagesCommand } from "./commands/pages.js";

/** Shared context passed to every command. */
export interface CommandContext {
  runner: WranglerRunner;
  account?: string;
  cwd?: string;
}

/** A top-level area command (whoami, workers, ...). */
export interface CommandArea {
  name: string;
  aliases?: string[];
  description: string;
  help: string[];
  run(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }>;
}

const areas: CommandArea[] = [
  whoamiCommand,
  workersCommand,
  secretsCommand,
  kvCommand,
  d1Command,
  r2Command,
  pagesCommand,
];

function findArea(name: string): CommandArea | undefined {
  return areas.find(
    (a) => a.name === name || (a.aliases?.includes(name) ?? false),
  );
}

export function topHelp(runnerNote: string): string {
  const lines = areas.map(
    (a) => `Run \`wrangler-axi ${a.name}\` — ${a.description}`,
  );
  lines.unshift("Run `wrangler-axi <area> <sub> [args]`");
  lines.unshift("Global flags: --help, --version, --account <id|name>");
  lines.push("Run `wrangler-axi <area> --help` for a specific area");
  return renderHelp(lines);
}

/**
 * Dispatch one CLI invocation. Returns the text to write to stdout and the
 * exit code. Does not process.exit — the caller (bin entry) decides that.
 */
export async function run(
  argv: string[],
  runner: WranglerRunner = realRunner,
  cwd?: string,
): Promise<{ stdout: string; exitCode: number }> {
  const ctx: CommandContext = { runner, cwd };

  // Global --version / -v at top level.
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return {
      stdout: renderOutput([
        `bin: wrangler-axi`,
        `description: Agent-ergonomic TOON wrapper around Cloudflare Wrangler`,
        topHelp(""),
      ]),
      exitCode: 0,
    };
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    return { stdout: `wrangler-axi: ${VERSION}`, exitCode: 0 };
  }

  let args = argv.slice();

  const areaName = args[0];
  if (areaName === undefined) {
    return { stdout: topHelp(""), exitCode: 0 };
  }

  const area = findArea(areaName);
  if (!area) {
    const err = new AxiError(
      `Unknown area "${areaName}"`,
      "VALIDATION_ERROR",
      [
        `Valid areas: ${areas.map((a) => a.name).join(", ")}`,
        "Run `wrangler-axi --help` for usage",
      ],
    );
    return { stdout: asError(err), exitCode: exitCodeForError(err) };
  }

  try {
    // Pull --account off globally (any position).
    const accountIdx = args.findIndex((a) => a === "--account" || a.startsWith("--account="));
    if (accountIdx !== -1) {
      const raw = args[accountIdx]!;
      if (raw.startsWith("--account=")) {
        ctx.account = raw.slice("--account=".length);
        args.splice(accountIdx, 1);
      } else {
        if (accountIdx + 1 >= args.length) {
          throw new AxiError(
            "Missing value for --account flag",
            "VALIDATION_ERROR",
            ["Run `wrangler-axi --help` for usage"],
          );
        }
        ctx.account = args[accountIdx + 1];
        args.splice(accountIdx, 2);
      }
    }

    const rest = args.slice(1);
    // Area-level --help (explicit only: help as the first arg after the area, e.g.
    // `wrangler-axi workers --help`). A `--help` after a subcommand is dispatched
    // to that subcommand so each has its own contextual help.
    if (rest[0] === "--help" || rest[0] === "-h") {
      return { stdout: renderHelp(area.help), exitCode: 0 };
    }

    const result = await area.run(ctx, rest);
    return result;
  } catch (err) {
    if (err instanceof AxiError) {
      return { stdout: asError(err), exitCode: exitCodeForError(err) };
    }
    const unexpected = new AxiError(
      err instanceof Error ? err.message : String(err),
      "UNKNOWN",
    );
    return { stdout: asError(unexpected), exitCode: 1 };
  }
}

function asError(err: AxiError): string {
  return renderError(err.message, err.code, err.suggestions);
}
