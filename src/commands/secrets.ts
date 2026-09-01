import type { CommandArea, CommandContext } from "../cli.js";
import { AxiError } from "../errors.js";
import { callWrangler, parseJson } from "../wrangler.js";
import { takeAllFlags, takeFlag, takeNumber } from "../args.js";
import { validateFlags, wantsHelp } from "../util.js";
import { readStdin, isStdinTTY } from "../stdin.js";
import {
  addExtraDefs,
  parseFields,
  type AvailableField,
} from "../fields.js";
import {
  custom,
  field,
  renderDetail,
  renderHelp,
  type FieldDef,
} from "../toon.js";
import { renderListBlock } from "../list.js";

interface Secret {
  name: string;
  type: string;
}

const VALID_FLAGS = ["--name", "--format", "--limit", "--fields", "--json", "--full"];

const available: Record<string, AvailableField> = {
  type: { def: field("type") },
};

export const secretsCommand: CommandArea = {
  name: "secrets",
  aliases: ["secret"],
  description: "manage Worker secrets (list/put/delete)",
  help: [
    "Usage: wrangler-axi secrets <list|put|delete> [args]",
    "  list    — list secrets for a worker",
    "  put     — create or update a secret (value via stdin)",
    "  delete  — delete a secret",
    "Global: --account <id|name>, --name <worker>",
    "Examples:",
    "  wrangler-axi secrets list --name my-worker",
    "  echo -n 's3cr3t' | wrangler-axi secrets put MY_KEY --name my-worker",
    "  wrangler-axi secrets delete MY_KEY --name my-worker",
  ],
  async run(ctx: CommandContext, args: string[]) {
    const sub = args[0];
    if (sub === undefined || wantsHelp(args)) {
      return { stdout: renderHelp(secretsCommand.help), exitCode: 0 };
    }
    const rest = args.slice(1);
    switch (sub) {
      case "list":
        return list(ctx, rest);
      case "put":
        return put(ctx, rest);
      case "delete":
        return del(ctx, rest);
      default:
        throw new AxiError(`Unknown secrets subcommand "${sub}"`, "VALIDATION_ERROR", [
          "Run `wrangler-axi secrets --help` for valid subcommands",
        ]);
    }
  },
};

function truncatingField(key: string, length = 20): FieldDef {
  return {
    render: (item: any) => {
      const value = (item && typeof item === "object" && key in item) ? item[key] : undefined;
      if (typeof value === "string") {
        if (value.length <= length) {
          return value;
        }
        return value.slice(0, length - 1) + "…";
      }
      return value;
    },
  };
}

async function list(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi secrets list [--name <worker>]",
        "Flags: --name <worker>, --fields <cols>, --limit <n>, --json, --full",
      ]),
      exitCode: 0,
    };
  }
  const json = takeAllFlags(args, ["--json"]).length > 0;
  const full = takeAllFlags(args, ["--full"]).length > 0;
  validateFlags(args, VALID_FLAGS, "secrets list");

  const wArgs = ["secret", "list", "--format", "json"];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  const worker = takeFlag(args, "--name");
  if (worker) {
    wArgs.push("--name", worker);
  }
  const limit = full ? undefined : takeNumber(args, "--limit");
  const fieldsArg = takeFlag(args, "--fields");

  const { stdout } = await callWrangler(ctx.runner, wArgs);
  if (json) {
    return { stdout, exitCode: 0 };
  }
  const items = parseJson<Secret[]>(stdout, "secrets");
  const { extraDefs, extraKeys } = parseFields(fieldsArg, available);
  const schema = addExtraDefs(
    {
      name: full ? field("name") : truncatingField("name", 20),
      type: field("type"),
    },
    extraDefs,
  );
  const blocks: Array<string | undefined> = [
    renderListBlock({
      noun: "secrets",
      items,
      schema,
      limit,
      empty: "secrets: no secrets found for this worker",
    }),
  ];
  if (extraKeys.length > 0 && Object.keys(available).length > 0) {
    blocks.push(
      renderHelp([`Available extra fields: ${Object.keys(available).join(", ")}`]),
    );
  }
  return { stdout: blocks.filter(Boolean).join("\n"), exitCode: 0 };
}

async function put(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: echo -n '<value>' | wrangler-axi secrets put <key> [--name <worker>]",
        "Creates or updates a secret. Value MUST come via stdin.",
      ]),
      exitCode: 0,
    };
  }
  validateFlags(args, ["--name"], "secrets put");
  // Take value-consuming flags before extracting the positional key.
  const worker = takeFlag(args, "--name");
  const key = args.filter((a) => !a.startsWith("-"))[0];
  if (!key) {
    throw new AxiError("secrets put requires a secret key", "VALIDATION_ERROR", [
      "Usage: wrangler-axi secrets put <key> [--name <worker>]",
    ]);
  }
  if (isStdinTTY()) {
    throw new AxiError("secrets put requires the secret value via stdin", "VALIDATION_ERROR", [
      "Usage: echo -n '<value>' | wrangler-axi secrets put <key> [--name <worker>]",
    ]);
  }
  const secretValue = await readStdin();
  if (!secretValue) {
    throw new AxiError("secrets put received empty stdin; a non-empty value is required", "VALIDATION_ERROR", [
      "Usage: echo -n '<value>' | wrangler-axi secrets put <key> [--name <worker>]",
    ]);
  }
  const wArgs = ["secret", "put", key];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  if (worker) {
    wArgs.push("--name", worker);
  }
  wArgs.push("--quiet");
  const { stdout } = await callWrangler(ctx.runner, wArgs, { input: secretValue });
  return {
    stdout: renderDetail(
      "secret",
      { key, worker: worker ?? "default worker", status: "written" },
      {
        key: custom((d: { key: string }) => d.key),
        worker: custom((d: { worker: string }) => d.worker),
        status: custom((d: { status: string }) => d.status),
      },
    ),
    exitCode: 0,
  };
}

async function del(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi secrets delete <key> [--name <worker>]",
        "Deletes a secret. Run with --force to skip confirmation.",
      ]),
      exitCode: 0,
    };
  }
  validateFlags(args, ["--name", "--force"], "secrets delete");
  // Take value-consuming flags before extracting the positional key.
  const worker = takeFlag(args, "--name");
  const key = args.filter((a) => !a.startsWith("-"))[0];
  if (!key) {
    throw new AxiError("secrets delete requires a secret key", "VALIDATION_ERROR", [
      "Usage: wrangler-axi secrets delete <key> [--name <worker>] [--force]",
    ]);
  }
  const wArgs = ["secret", "delete", key];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  if (worker) {
    wArgs.push("--name", worker);
  }
  if (takeAllFlags(args, ["--force"]).length > 0) {
    wArgs.push("-y");
  }
  const { stdout } = await callWrangler(ctx.runner, wArgs);
  return {
    stdout: renderDetail(
      "secret",
      { key, worker: worker ?? "default worker", status: "deleted" },
      {
        key: custom((d: { key: string }) => d.key),
        worker: custom((d: { worker: string }) => d.worker),
        status: custom((d: { status: string }) => d.status),
      },
    ),
    exitCode: 0,
  };
}
