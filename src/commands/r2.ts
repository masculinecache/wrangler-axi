import type { CommandArea, CommandContext } from "../cli.js";
import { AxiError, stripAnsi } from "../errors.js";
import { callWrangler, parseJson } from "../wrangler.js";
import { takeAllFlags, takeFlag, takeNumber } from "../args.js";
import { validateFlags, wantsHelp } from "../util.js";
import {
  addExtraDefs,
  parseFields,
  type AvailableField,
} from "../fields.js";
import { custom, field, renderDetail, renderHelp } from "../toon.js";
import { renderListBlock } from "../list.js";

interface Bucket {
  name: string;
  creation_date?: string;
  location?: string;
  storage_class?: string;
  size?: number;
  [k: string]: unknown;
}

const bucketAvailable: Record<string, AvailableField> = {
  created: { def: field("creation_date") },
};

/**
 * Parse wrangler's human `r2 bucket list` output. Wrangler 4.x rejects
 * `--json` for this command; it prints one `label: value` block per bucket
 * (name, creation_date), optionally ANSI-colored when attached to a TTY.
 */
function parseBucketListOutput(stdout: string): Bucket[] {
  const clean = stripAnsi(stdout);
  const buckets: Bucket[] = [];
  let current: { name?: string; creation_date?: string } = {};
  for (const line of clean.split("\n")) {
    const m = /^(name|creation_date):\s*(.*)$/.exec(line);
    if (!m) {
      continue;
    }
    if (m[1] === "name") {
      if (current.name !== undefined) {
        buckets.push(current as Bucket);
      }
      current = { name: m[2] };
    } else if (current.name !== undefined) {
      current.creation_date = m[2];
    }
  }
  if (current.name !== undefined) {
    buckets.push(current as Bucket);
  }
  return buckets;
}

export const r2Command: CommandArea = {
  name: "r2",
  description: "manage R2 buckets (list, info, object pass-through)",
  help: [
    "Usage: wrangler-axi r2 <bucket|object> <sub> [args]",
    "  bucket list / info <name>   — list or inspect R2 buckets",
    "  object get/put/delete <path> — pass-through object operations",
    "Note: wrangler has no `r2 object list`; listing objects is not supported.",
    "Example: wrangler-axi r2 bucket list",
    "Example: wrangler-axi r2 bucket info my-bucket",
  ],
  async run(ctx: CommandContext, args: string[]) {
    const sub = args[0];
    if (sub === undefined || wantsHelp(args)) {
      return { stdout: renderHelp(r2Command.help), exitCode: 0 };
    }
    const rest = args.slice(1);
    switch (sub) {
      case "bucket":
        return bucket(ctx, rest);
      case "object":
        return object(ctx, rest);
      default:
        throw new AxiError(`Unknown r2 subcommand "${sub}"`, "VALIDATION_ERROR", [
          "Run `wrangler-axi r2 --help` for valid subcommands",
        ]);
    }
  },
};

async function bucket(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi r2 bucket <list|info|create|delete> [args]",
      ]),
      exitCode: 0,
    };
  }
  const sub = args[0];
  if (sub === undefined || sub.startsWith("-")) {
    throw new AxiError("r2 bucket requires a subcommand", "VALIDATION_ERROR", [
      "Run `wrangler-axi r2 bucket --help` for valid subcommands",
    ]);
  }
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return bucketList(ctx, rest);
    case "info":
      return bucketInfo(ctx, rest);
    case "create":
      return bucketCreate(ctx, rest);
    case "delete":
      return bucketDelete(ctx, rest);
    default:
      throw new AxiError(`Unknown r2 bucket subcommand "${sub}"`, "VALIDATION_ERROR", [
        "Run `wrangler-axi r2 bucket --help` for valid subcommands",
      ]);
  }
}

async function bucketList(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi r2 bucket list [--fields] [--limit] [--full] [--json]",
      ]),
      exitCode: 0,
    };
  }
  const json = takeAllFlags(args, ["--json"]).length > 0;
  const full = takeAllFlags(args, ["--full"]).length > 0;
  validateFlags(args, ["--fields", "--limit", "--full", "--json"], "r2 bucket list");
  // wrangler's `r2 bucket list` rejects --json; parse its human output and
  // provide the wrapper-side --json escape hatch from the parsed items.
  const wArgs = ["r2", "bucket", "list"];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  const limit = full ? undefined : takeNumber(args, "--limit");
  const fieldsArg = takeFlag(args, "--fields");
  const { stdout } = await callWrangler(ctx.runner, wArgs);
  const items = parseBucketListOutput(stdout);
  if (json) {
    return { stdout: JSON.stringify(items, null, 2), exitCode: 0 };
  }
  const { extraDefs } = parseFields(fieldsArg, bucketAvailable);
  const schema = addExtraDefs(
    {
      name: field("name"),
      created: field("creation_date"),
    },
    extraDefs,
  );
  return {
    stdout: renderListBlock({
      noun: "buckets",
      items,
      schema,
      limit,
      empty: "buckets: no R2 buckets found",
      truncatedHint: "Run `wrangler-axi r2 bucket list --json` for the full set",
    }),
    exitCode: 0,
  };
}

async function bucketInfo(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi r2 bucket info <name>",
      ]),
      exitCode: 0,
    };
  }
  validateFlags(args, [], "r2 bucket info");
  const name = args.filter((a) => !a.startsWith("-"))[0];
  if (!name) {
    throw new AxiError("r2 bucket info requires a bucket name", "VALIDATION_ERROR", [
      "Usage: wrangler-axi r2 bucket info <name>",
    ]);
  }
  const wArgs = ["r2", "bucket", "info", name, "--json"];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  const { stdout } = await callWrangler(ctx.runner, wArgs);
  const data = parseJson<Bucket>(stdout, "r2 bucket");
  return {
    stdout: renderDetail(
      "bucket",
      data,
      {
        name: custom((b: Bucket) => b.name ?? name),
        location: custom((b: Bucket) => b.location ?? "unknown"),
        storage_class: custom((b: Bucket) => b.storage_class ?? "unknown"),
        size: custom((b: Bucket) => b.size ?? 0),
      },
    ),
    exitCode: 0,
  };
}

async function bucketCreate(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi r2 bucket create <name>",
      ]),
      exitCode: 0,
    };
  }
  validateFlags(args, [], "r2 bucket create");
  const name = args.filter((a) => !a.startsWith("-"))[0];
  if (!name) {
    throw new AxiError("r2 bucket create requires a bucket name", "VALIDATION_ERROR", [
      "Usage: wrangler-axi r2 bucket create <name>",
    ]);
  }
  const wArgs = ["r2", "bucket", "create", name];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  await callWrangler(ctx.runner, wArgs);
  return {
    stdout: renderDetail(
      "bucket",
      { name, status: "created" },
      {
        name: custom((d: { name: string }) => d.name),
        status: custom((d: { status: string }) => d.status),
      },
    ),
    exitCode: 0,
  };
}

async function bucketDelete(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi r2 bucket delete <name> [--force]",
      ]),
      exitCode: 0,
    };
  }
  validateFlags(args, ["--force"], "r2 bucket delete");
  const name = args.filter((a) => !a.startsWith("-"))[0];
  if (!name) {
    throw new AxiError("r2 bucket delete requires a bucket name", "VALIDATION_ERROR", [
      "Usage: wrangler-axi r2 bucket delete <name>",
    ]);
  }
  const wArgs = ["r2", "bucket", "delete", name];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  if (takeAllFlags(args, ["--force"]).length > 0) {
    wArgs.push("-f");
  }
  await callWrangler(ctx.runner, wArgs);
  return {
    stdout: renderDetail(
      "bucket",
      { name, status: "deleted" },
      {
        name: custom((d: { name: string }) => d.name),
        status: custom((d: { status: string }) => d.status),
      },
    ),
    exitCode: 0,
  };
}

async function object(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi r2 object <get|put|delete> <objectPath>",
        "Pass-through to wrangler r2 object. Use --binding or --bucket to target.",
        "Note: listing objects is not supported (wrangler has no r2 object list).",
      ]),
      exitCode: 0,
    };
  }
  const sub = args[0];
  if (sub === undefined || sub.startsWith("-")) {
    throw new AxiError("r2 object requires a subcommand", "VALIDATION_ERROR", [
      "Run `wrangler-axi r2 object --help` for valid subcommands",
    ]);
  }
  if (sub === "list") {
    throw new AxiError(
      "r2 object list is not supported — wrangler has no native object listing command",
      "VALIDATION_ERROR",
      ["Use `wrangler-axi r2 bucket info <name>` to inspect a bucket"],
    );
  }
  const rest = args.slice(1);
  // Take value-consuming flags before extracting the positional object path.
  const flagValues: Record<string, string | undefined> = {};
  for (const f of ["--binding", "--bucket", "--text", "--file", "--path", "--ttl"]) {
    flagValues[f] = takeFlag(rest, f);
  }
  const objectPath = rest.filter((a) => !a.startsWith("-"))[0];
  if (!objectPath) {
    throw new AxiError(`r2 object ${sub} requires an object path`, "VALIDATION_ERROR", [
      `Usage: wrangler-axi r2 object ${sub} <path>`,
    ]);
  }
  validateFlags(
    rest,
    ["--binding", "--bucket", "--text", "--file", "--path", "--json", "--ttl"],
    `r2 object ${sub}`,
  );
  const wArgs = ["r2", "object", sub, objectPath];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  for (const [f, v] of Object.entries(flagValues)) {
    if (v !== undefined) {
      wArgs.push(f, v);
    }
  }
  const { stdout } = await callWrangler(ctx.runner, wArgs);
  if (takeAllFlags(rest, ["--json"]).length > 0) {
    return { stdout, exitCode: 0 };
  }
  return {
    stdout: renderDetail(
      "object",
      { path: objectPath, status: sub },
      {
        path: custom((d: { path: string }) => d.path),
        status: custom((d: { status: string }) => d.status),
        output: custom(() => stdout.trim() || "(no output)"),
      },
    ),
    exitCode: 0,
  };
}
