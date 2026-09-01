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

interface Database {
  name: string;
  id: string;
  created_at?: string;
  uuid?: string;
  [k: string]: unknown;
}

const dbAvailable: Record<string, AvailableField> = {
  created: { def: field("created_at") },
  uuid: { def: field("uuid") },
};

const DATABASE_FLAGS = ["--json"];

export const d1Command: CommandArea = {
  name: "d1",
  description: "manage D1 databases (list, query)",
  help: [
    "Usage: wrangler-axi d1 <databases|query> [args]",
    "  databases list  — list D1 databases",
    "  query <name>    — run a SQL command against a database",
    "Example: wrangler-axi d1 databases list",
    "Example: wrangler-axi d1 query my-db --command 'SELECT * FROM users'",
  ],
  async run(ctx: CommandContext, args: string[]) {
    const sub = args[0];
    if (sub === undefined || wantsHelp(args)) {
      return { stdout: renderHelp(d1Command.help), exitCode: 0 };
    }
    const rest = args.slice(1);
    switch (sub) {
      case "databases":
        return databases(ctx, rest);
      case "query":
        return query(ctx, rest);
      default:
        throw new AxiError(`Unknown d1 subcommand "${sub}"`, "VALIDATION_ERROR", [
          "Run `wrangler-axi d1 --help` for valid subcommands",
        ]);
    }
  },
};

async function databases(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi d1 databases list [--fields] [--limit] [--full] [--json]",
      ]),
      exitCode: 0,
    };
  }
  const sub = args[0];
  if (sub !== undefined && sub !== "list" && !sub.startsWith("-")) {
    throw new AxiError(`Unknown d1 databases subcommand "${sub}"`, "VALIDATION_ERROR", [
      "Run `wrangler-axi d1 databases --help` for valid subcommands",
    ]);
  }
  const listArgs = sub === "list" ? args.slice(1) : args;
  const json = takeAllFlags(listArgs, ["--json"]).length > 0;
  const full = takeAllFlags(listArgs, ["--full"]).length > 0;
  validateFlags(listArgs, ["--fields", "--limit", "--full", "--json"], "d1 databases list");
  const wArgs = ["d1", "list", "--json"];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  const limit = full ? undefined : takeNumber(listArgs, "--limit");
  const fieldsArg = takeFlag(listArgs, "--fields");
  const { stdout } = await callWrangler(ctx.runner, wArgs);
  if (json) {
    return { stdout, exitCode: 0 };
  }
  const items = parseJson<Database[]>(stdout, "d1 databases");
  const { extraDefs } = parseFields(fieldsArg, dbAvailable);
  const schema = addExtraDefs(
    {
      name: field("name"),
      id: field("id"),
    },
    extraDefs,
  );
  return {
    stdout: renderListBlock({
      noun: "databases",
      items,
      schema,
      limit,
      empty: "databases: no D1 databases found",
      truncatedHint: "Run `wrangler-axi d1 databases list --json` for the full set",
    }),
    exitCode: 0,
  };
}

async function query(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi d1 query <database> [--command <sql> | --file <path>]",
        "Flags: --command <sql>, --file <path>, --local/--remote, --json",
      ]),
      exitCode: 0,
    };
  }
  const json = takeAllFlags(args, ["--json"]).length > 0;
  validateFlags(
    args,
    ["--command", "--file", "--local", "--remote", "--yes", "--json"],
    "d1 query",
  );
  // Take value-consuming flags before extracting the positional db name.
  const command = takeFlag(args, "--command");
  const file = takeFlag(args, "--file");
  const db = args.filter((a) => !a.startsWith("-"))[0];
  if (!db) {
    throw new AxiError("d1 query requires a database name", "VALIDATION_ERROR", [
      "Usage: wrangler-axi d1 query <database> --command <sql>|--file <f>",
    ]);
  }
  if (!command && !file) {
    throw new AxiError("d1 query requires --command or --file", "VALIDATION_ERROR", [
      "Run `wrangler-axi d1 query --help` for usage",
    ]);
  }
  const wArgs = ["d1", "execute", db];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  if (command) {
    wArgs.push("--command", command);
  } else {
    wArgs.push("--file", file!);
  }
  const remote = takeAllFlags(args, ["--remote"]).length > 0;
  if (remote) {
    wArgs.push("--remote");
  } else {
    wArgs.push("--local");
  }
  if (takeAllFlags(args, ["--yes"]).length > 0) {
    wArgs.push("-y");
  }
  if (json) {
    wArgs.push("--json");
  }
  const { stdout } = await callWrangler(ctx.runner, wArgs);
  if (json) {
    return { stdout, exitCode: 0 };
  }
  return {
    stdout: renderDetail(
      "query",
      { database: db, status: "executed" },
      {
        database: custom((d: { database: string }) => d.database),
        status: custom((d: { status: string }) => d.status),
        output: custom(() => stdout.trim() || "(no rows)"),
      },
    ),
    exitCode: 0,
  };
}
