import type { CommandArea, CommandContext } from "../cli.js";
import { AxiError } from "../errors.js";
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

interface Namespace {
  id?: string;
  title?: string;
  supports_url_encoding?: boolean;
  [k: string]: unknown;
}

interface KVKey {
  name: string;
  expiration?: number | null;
}

const keyAvailable: Record<string, AvailableField> = {
  expiration: { def: field("expiration") },
};

const nsAvailable: Record<string, AvailableField> = {
  title: { def: field("title") },
};

const NS_FLAGS = ["--title", "--json", "--namespace-id"];

export const kvCommand: CommandArea = {
  name: "kv",
  description: "manage KV namespaces and keys",
  help: [
    "Usage: wrangler-axi kv <namespace|key> <sub> [args]",
    "  namespace <list|create|delete|rename>",
    "  key       <list|get|put>",
    "Example: wrangler-axi kv namespace list",
    "Example: wrangler-axi kv key list --namespace-id <id>",
  ],
  async run(ctx: CommandContext, args: string[]) {
    const sub = args[0];
    if (sub === undefined || wantsHelp(args)) {
      return { stdout: renderHelp(kvCommand.help), exitCode: 0 };
    }
    const rest = args.slice(1);
    switch (sub) {
      case "namespace":
        return namespace(ctx, rest);
      case "key":
        return key(ctx, rest);
      default:
        throw new AxiError(`Unknown kv subcommand "${sub}"`, "VALIDATION_ERROR", [
          "Run `wrangler-axi kv --help` for valid subcommands",
        ]);
    }
  },
};

async function namespace(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi kv namespace <list|create|delete|rename> [args]",
        "  list                    — list KV namespaces",
        "  create <title>          — create a namespace",
        "  delete <namespace-id>   — delete a namespace",
        "  rename <old-name>       — rename a namespace",
      ]),
      exitCode: 0,
    };
  }
  const sub = args[0];
  if (sub === undefined || sub.startsWith("-")) {
    throw new AxiError("kv namespace requires a subcommand", "VALIDATION_ERROR", [
      "Run `wrangler-axi kv namespace --help` for valid subcommands",
    ]);
  }
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return nsList(ctx, rest);
    case "create":
      return nsCreate(ctx, rest);
    case "delete":
      return nsDelete(ctx, rest);
    case "rename":
      return nsRename(ctx, rest);
    default:
      throw new AxiError(`Unknown kv namespace subcommand "${sub}"`, "VALIDATION_ERROR", [
        "Run `wrangler-axi kv namespace --help` for valid subcommands",
      ]);
  }
}

async function nsList(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi kv namespace list [--fields] [--limit] [--full] [--json]",
      ]),
      exitCode: 0,
    };
  }
  const json = takeAllFlags(args, ["--json"]).length > 0;
  const full = takeAllFlags(args, ["--full"]).length > 0;
  validateFlags(args, ["--fields", "--limit", "--full", "--json"], "kv namespace list");
  // wrangler's `kv namespace list` rejects --json but already prints JSON.
  const wArgs = ["kv", "namespace", "list"];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  const limit = full ? undefined : takeNumber(args, "--limit");
  const fieldsArg = takeFlag(args, "--fields");
  const { stdout } = await callWrangler(ctx.runner, wArgs);
  if (json) {
    return { stdout, exitCode: 0 };
  }
  const items = parseJson<Namespace[]>(stdout, "kv namespaces");
  const { extraDefs } = parseFields(fieldsArg, nsAvailable);
  const schema = addExtraDefs(
    {
      id: field("id"),
      title: field("title"),
    },
    extraDefs,
  );
  return {
    stdout: renderListBlock({
      noun: "namespaces",
      items,
      schema,
      limit,
      empty: "namespaces: no KV namespaces found",
      truncatedHint: "Run `wrangler-axi kv namespace list --json` for the full set",
    }),
    exitCode: 0,
  };
}

async function nsCreate(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi kv namespace create <title> [--json]",
      ]),
      exitCode: 0,
    };
  }
  validateFlags(args, ["--json"], "kv namespace create");
  // wrangler's `kv namespace create` rejects --json and prints human output
  // only, so --json is a wrapper-side escape hatch here.
  const json = takeAllFlags(args, ["--json"]).length > 0;
  const title = args.filter((a) => !a.startsWith("-"))[0];
  if (!title) {
    throw new AxiError("kv namespace create requires a title", "VALIDATION_ERROR", [
      "Usage: wrangler-axi kv namespace create <title>",
    ]);
  }
  const wArgs = ["kv", "namespace", "create", title];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  await callWrangler(ctx.runner, wArgs);
  if (json) {
    return { stdout: JSON.stringify({ title, status: "created" }, null, 2), exitCode: 0 };
  }
  return {
    stdout: renderDetail(
      "namespace",
      { title, status: "created" },
      {
        title: custom((d: { title: string }) => d.title),
        status: custom((d: { status: string }) => d.status),
      },
    ),
    exitCode: 0,
  };
}

async function nsDelete(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi kv namespace delete <namespace-id> [--force]",
      ]),
      exitCode: 0,
    };
  }
  validateFlags(args, ["--force"], "kv namespace delete");
  const id = args.filter((a) => !a.startsWith("-"))[0];
  if (!id) {
    throw new AxiError("kv namespace delete requires a namespace id", "VALIDATION_ERROR", [
      "Usage: wrangler-axi kv namespace delete <namespace-id>",
    ]);
  }
  const wArgs = ["kv", "namespace", "delete", id];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  if (takeAllFlags(args, ["--force"]).length > 0) {
    wArgs.push("-f");
  }
  await callWrangler(ctx.runner, wArgs);
  return {
    stdout: renderDetail(
      "namespace",
      { id, status: "deleted" },
      {
        id: custom((d: { id: string }) => d.id),
        status: custom((d: { status: string }) => d.status),
      },
    ),
    exitCode: 0,
  };
}

async function nsRename(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi kv namespace rename <old-name> [--title <new>]",
      ]),
      exitCode: 0,
    };
  }
  validateFlags(args, ["--title"], "kv namespace rename");
  // Take value-consuming flags before extracting the positional old name.
  const title = takeFlag(args, "--title");
  const oldName = args.filter((a) => !a.startsWith("-"))[0];
  if (!oldName) {
    throw new AxiError("kv namespace rename requires the current name", "VALIDATION_ERROR", [
      "Usage: wrangler-axi kv namespace rename <old-name>",
    ]);
  }
  const wArgs = ["kv", "namespace", "rename", oldName];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  if (title) {
    wArgs.push("--title", title);
  }
  await callWrangler(ctx.runner, wArgs);
  return {
    stdout: renderDetail(
      "namespace",
      { name: title ?? oldName, status: "renamed" },
      {
        name: custom((d: { name: string }) => d.name),
        status: custom((d: { status: string }) => d.status),
      },
    ),
    exitCode: 0,
  };
}

async function key(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi kv key <list|get|put> [args]",
        "  list              — list keys in a namespace",
        "  get <key>         — get a key's value",
        "  put <key> <value> — write a key (or use --path)",
        "Flag to select namespace: --namespace-id <id> (or --binding <name>)",
      ]),
      exitCode: 0,
    };
  }
  const sub = args[0];
  if (sub === undefined || sub.startsWith("-")) {
    throw new AxiError("kv key requires a subcommand", "VALIDATION_ERROR", [
      "Run `wrangler-axi kv key --help` for valid subcommands",
    ]);
  }
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return keyList(ctx, rest);
    case "get":
      return keyGet(ctx, rest);
    case "put":
      return keyPut(ctx, rest);
    default:
      throw new AxiError(`Unknown kv key subcommand "${sub}"`, "VALIDATION_ERROR", [
        "Run `wrangler-axi kv key --help` for valid subcommands",
      ]);
  }
}

async function keyList(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi kv key list --namespace-id <id> [--prefix] [--fields] [--limit] [--full] [--json]",
      ]),
      exitCode: 0,
    };
  }
  const json = takeAllFlags(args, ["--json"]).length > 0;
  const full = takeAllFlags(args, ["--full"]).length > 0;
  validateFlags(args, ["--namespace-id", "--binding", "--prefix", "--fields", "--limit", "--full", "--json"], "kv key list");
  const wArgs = ["kv", "key", "list"];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  const nsId = takeFlag(args, "--namespace-id");
  const binding = takeFlag(args, "--binding");
  if (nsId) {
    wArgs.push("--namespace-id", nsId);
  } else if (binding) {
    wArgs.push("--binding", binding);
  } else {
    throw new AxiError("kv key list requires --namespace-id or --binding", "VALIDATION_ERROR", [
      "Run `wrangler-axi kv key list --help` for usage",
    ]);
  }
  const prefix = takeFlag(args, "--prefix");
  if (prefix !== undefined) {
    wArgs.push("--prefix", prefix);
  }
  const limit = full ? undefined : takeNumber(args, "--limit");
  const fieldsArg = takeFlag(args, "--fields");
  const { stdout } = await callWrangler(ctx.runner, wArgs);
  if (json) {
    return { stdout, exitCode: 0 };
  }
  const items = parseJson<KVKey[]>(stdout, "kv keys");
  const { extraDefs } = parseFields(fieldsArg, keyAvailable);
  const schema = addExtraDefs(
    {
      name: field("name"),
    },
    extraDefs,
  );
  return {
    stdout: renderListBlock({
      noun: "keys",
      items,
      schema,
      limit,
      empty: "keys: no keys found in this namespace",
      truncatedHint: "Run `wrangler-axi kv key list --namespace-id <id> --json` for the full set",
    }),
    exitCode: 0,
  };
}

async function keyGet(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi kv key get <key> --namespace-id <id> [--text]",
      ]),
      exitCode: 0,
    };
  }
  validateFlags(args, ["--namespace-id", "--binding", "--text"], "kv key get");
  // Take value-consuming flags before extracting the positional key name.
  const nsId = takeFlag(args, "--namespace-id");
  const binding = takeFlag(args, "--binding");
  const name = args.filter((a) => !a.startsWith("-"))[0];
  if (!name) {
    throw new AxiError("kv key get requires a key name", "VALIDATION_ERROR", [
      "Usage: wrangler-axi kv key get <key> --namespace-id <id>|--binding <b>",
    ]);
  }
  const wArgs = ["kv", "key", "get", name, "--text"];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  if (nsId) {
    wArgs.push("--namespace-id", nsId);
  } else if (binding) {
    wArgs.push("--binding", binding);
  } else {
    throw new AxiError("kv key get requires --namespace-id or --binding", "VALIDATION_ERROR", [
      "Run `wrangler-axi kv key get --help` for usage",
    ]);
  }
  const { stdout } = await callWrangler(ctx.runner, wArgs);
  return {
    stdout: renderDetail(
      "key",
      { name, value: stdout.replace(/\n$/, "") },
      {
        name: custom((d: { name: string }) => d.name),
        value: custom((d: { value: string }) => d.value || "(empty)"),
      },
    ),
    exitCode: 0,
  };
}

async function keyPut(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi kv key put <key> <value> --namespace-id <id>",
        "       wrangler-axi kv key put <key> --path <file> --namespace-id <id>",
      ]),
      exitCode: 0,
    };
  }
  validateFlags(args, ["--namespace-id", "--binding", "--path", "--ttl", "--expiration", "--metadata"], "kv key put");
  // Take every value-consuming flag BEFORE capturing positionals, so a
  // space-form flag value (e.g. `--namespace-id ns1`) is not misread as the
  // key value and silently written to KV. Only the key and value remain.
  const nsId = takeFlag(args, "--namespace-id");
  const binding = takeFlag(args, "--binding");
  const path = takeFlag(args, "--path");
  const ttl = takeFlag(args, "--ttl");
  const expiration = takeFlag(args, "--expiration");
  const metadata = takeFlag(args, "--metadata");
  const positional = args.filter((a) => !a.startsWith("-"));
  const name = positional[0];
  if (!name) {
    throw new AxiError("kv key put requires a key name", "VALIDATION_ERROR", [
      "Usage: wrangler-axi kv key put <key> <value|--path <p>> --namespace-id <id>|--binding <b>",
    ]);
  }
  const wArgs = ["kv", "key", "put", name];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  if (nsId) {
    wArgs.push("--namespace-id", nsId);
  } else if (binding) {
    wArgs.push("--binding", binding);
  } else {
    throw new AxiError("kv key put requires --namespace-id or --binding", "VALIDATION_ERROR", [
      "Run `wrangler-axi kv key put --help` for usage",
    ]);
  }
  if (path) {
    wArgs.push("--path", path);
  } else {
    const value = positional[1];
    if (value === undefined) {
      throw new AxiError("kv key put requires a value or --path", "VALIDATION_ERROR", [
        "Usage: wrangler-axi kv key put <key> <value>  or  --path <file>",
      ]);
    }
    wArgs.push(value);
  }
  if (ttl !== undefined) {
    wArgs.push("--ttl", ttl);
  }
  if (expiration !== undefined) {
    wArgs.push("--expiration", expiration);
  }
  if (metadata !== undefined) {
    wArgs.push("--metadata", metadata);
  }
  await callWrangler(ctx.runner, wArgs);
  return {
    stdout: renderDetail(
      "key",
      { name, status: "written" },
      {
        name: custom((d: { name: string }) => d.name),
        status: custom((d: { status: string }) => d.status),
      },
    ),
    exitCode: 0,
  };
}
