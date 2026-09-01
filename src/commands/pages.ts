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
import { custom, field, relativeTime, renderDetail, renderHelp } from "../toon.js";
import { renderListBlock } from "../list.js";

interface Project {
  name: string;
  created_on?: string;
  domains?: string[];
  [k: string]: unknown;
}

interface Deployment {
  id?: string;
  url?: string;
  created_on?: string;
  environment?: string;
  latest_stage?: string;
  [k: string]: unknown;
}

const projectAvailable: Record<string, AvailableField> = {
  created: { def: relativeTime("created_on", "created") },
  domains: { def: field("domains") },
};

const deploymentAvailable: Record<string, AvailableField> = {
  created: { def: relativeTime("created_on", "created") },
  environment: { def: field("environment") },
  latest: { def: field("latest_stage") },
};

export const pagesCommand: CommandArea = {
  name: "pages",
  description: "manage Cloudflare Pages projects and deployments",
  help: [
    "Usage: wrangler-axi pages <project|deployment> <sub> [args]",
    "  project    — list/create/delete Pages projects",
    "  deployment — list Pages deployments",
    "Example: wrangler-axi pages project list",
    "Example: wrangler-axi pages deployment list --project-name my-site",
  ],
  async run(ctx: CommandContext, args: string[]) {
    const sub = args[0];
    if (sub === undefined || wantsHelp(args)) {
      return { stdout: renderHelp(pagesCommand.help), exitCode: 0 };
    }
    const rest = args.slice(1);
    switch (sub) {
      case "project":
        return project(ctx, rest);
      case "deployment":
        return deployment(ctx, rest);
      default:
        throw new AxiError(`Unknown pages subcommand "${sub}"`, "VALIDATION_ERROR", [
          "Run `wrangler-axi pages --help` for valid subcommands",
        ]);
    }
  },
};

async function project(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi pages project <list|create|delete> [args]",
        "  list                 — list Pages projects",
        "  create <name>        — create a project",
        "  delete <name>        — delete a project",
      ]),
      exitCode: 0,
    };
  }
  const sub = args[0];
  if (sub === undefined || sub.startsWith("-")) {
    throw new AxiError("pages project requires a subcommand", "VALIDATION_ERROR", [
      "Run `wrangler-axi pages project --help` for valid subcommands",
    ]);
  }
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return projectList(ctx, rest);
    case "create":
      return projectCreate(ctx, rest);
    case "delete":
      return projectDelete(ctx, rest);
    default:
      throw new AxiError(`Unknown pages project subcommand "${sub}"`, "VALIDATION_ERROR", [
        "Run `wrangler-axi pages project --help` for valid subcommands",
      ]);
  }
}

async function projectList(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi pages project list [--fields] [--limit] [--full] [--json]",
      ]),
      exitCode: 0,
    };
  }
  const json = takeAllFlags(args, ["--json"]).length > 0;
  const full = takeAllFlags(args, ["--full"]).length > 0;
  validateFlags(args, ["--fields", "--limit", "--full", "--json"], "pages project list");
  const wArgs = ["pages", "project", "list", "--json"];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  const limit = full ? undefined : takeNumber(args, "--limit");
  const fieldsArg = takeFlag(args, "--fields");
  const { stdout } = await callWrangler(ctx.runner, wArgs);
  if (json) {
    return { stdout, exitCode: 0 };
  }
  const items = parseJson<Project[]>(stdout, "pages projects");
  const { extraDefs } = parseFields(fieldsArg, projectAvailable);
  const schema = addExtraDefs(
    {
      name: field("name"),
      domains: field("domains"),
    },
    extraDefs,
  );
  return {
    stdout: renderListBlock({
      noun: "projects",
      items,
      schema,
      limit,
      empty: "projects: no Pages projects found",
      truncatedHint: "Run `wrangler-axi pages project list --json` for the full set",
    }),
    exitCode: 0,
  };
}

async function projectCreate(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi pages project create <name> [--json]",
      ]),
      exitCode: 0,
    };
  }
  validateFlags(args, ["--json"], "pages project create");
  // wrangler's `pages project create` rejects --json and prints human output
  // only, so --json is a wrapper-side escape hatch here.
  const json = takeAllFlags(args, ["--json"]).length > 0;
  const name = args.filter((a) => !a.startsWith("-"))[0];
  if (!name) {
    throw new AxiError("pages project create requires a project name", "VALIDATION_ERROR", [
      "Usage: wrangler-axi pages project create <name>",
    ]);
  }
  const wArgs = ["pages", "project", "create", name];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  await callWrangler(ctx.runner, wArgs);
  if (json) {
    return { stdout: JSON.stringify({ name, status: "created" }, null, 2), exitCode: 0 };
  }
  return {
    stdout: renderDetail(
      "project",
      { name, status: "created" },
      {
        name: custom((d: { name: string }) => d.name),
        status: custom((d: { status: string }) => d.status),
      },
    ),
    exitCode: 0,
  };
}

async function projectDelete(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi pages project delete <name> [--force]",
      ]),
      exitCode: 0,
    };
  }
  validateFlags(args, ["--force"], "pages project delete");
  const name = args.filter((a) => !a.startsWith("-"))[0];
  if (!name) {
    throw new AxiError("pages project delete requires a project name", "VALIDATION_ERROR", [
      "Usage: wrangler-axi pages project delete <name>",
    ]);
  }
  const wArgs = ["pages", "project", "delete", name];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  if (takeAllFlags(args, ["--force"]).length > 0) {
    wArgs.push("-f");
  }
  await callWrangler(ctx.runner, wArgs);
  return {
    stdout: renderDetail(
      "project",
      { name, status: "deleted" },
      {
        name: custom((d: { name: string }) => d.name),
        status: custom((d: { status: string }) => d.status),
      },
    ),
    exitCode: 0,
  };
}

async function deployment(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi pages deployment <list|create|delete> [args]",
        "  list   — list deployments for a project",
        "  create [dir] — deploy a directory",
        "  delete <id>  — delete a deployment",
      ]),
      exitCode: 0,
    };
  }
  const sub = args[0];
  if (sub === undefined || sub.startsWith("-")) {
    throw new AxiError("pages deployment requires a subcommand", "VALIDATION_ERROR", [
      "Run `wrangler-axi pages deployment --help` for valid subcommands",
    ]);
  }
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return deploymentList(ctx, rest);
    case "create":
      return deploymentCreate(ctx, rest);
    case "delete":
      return deploymentDelete(ctx, rest);
    default:
      throw new AxiError(`Unknown pages deployment subcommand "${sub}"`, "VALIDATION_ERROR", [
        "Run `wrangler-axi pages deployment --help` for valid subcommands",
      ]);
  }
}

async function deploymentList(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi pages deployment list --project-name <name> [--environment production|preview] [--fields] [--limit] [--full] [--json]",
      ]),
      exitCode: 0,
    };
  }
  const json = takeAllFlags(args, ["--json"]).length > 0;
  const full = takeAllFlags(args, ["--full"]).length > 0;
  validateFlags(args, ["--project-name", "--environment", "--fields", "--limit", "--full", "--json"], "pages deployment list");
  const projectName = takeFlag(args, "--project-name");
  if (!projectName) {
    throw new AxiError("pages deployment list requires --project-name", "VALIDATION_ERROR", [
      "Run `wrangler-axi pages deployment list --help` for usage",
    ]);
  }
  const wArgs = ["pages", "deployment", "list", "--project-name", projectName];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  const env = takeFlag(args, "--environment");
  if (env) {
    wArgs.push("--environment", env);
  }
  wArgs.push("--json");
  const limit = full ? undefined : takeNumber(args, "--limit");
  const fieldsArg = takeFlag(args, "--fields");
  const { stdout } = await callWrangler(ctx.runner, wArgs);
  if (json) {
    return { stdout, exitCode: 0 };
  }
  const items = parseJson<Deployment[]>(stdout, "pages deployments");
  const { extraDefs } = parseFields(fieldsArg, deploymentAvailable);
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
      empty: "deployments: no deployments found for this project",
      truncatedHint: "Run `wrangler-axi pages deployment list --project-name <name> --json` for the full set",
    }),
    exitCode: 0,
  };
}

async function deploymentCreate(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi pages deployment create [directory] [--project-name <name>]",
      ]),
      exitCode: 0,
    };
  }
  validateFlags(args, ["--project-name"], "pages deployment create");
  // Take value-consuming flags before extracting the positional directory.
  const projectName = takeFlag(args, "--project-name");
  const dir = args.filter((a) => !a.startsWith("-"))[0];
  const wArgs = ["pages", "deployment", "create"];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  if (dir) {
    wArgs.push(dir);
  }
  if (projectName) {
    wArgs.push("--project-name", projectName);
  }
  const { stdout } = await callWrangler(ctx.runner, wArgs);
  return {
    stdout: renderDetail(
      "deployment",
      { project: projectName ?? "(default)", status: "deployed" },
      {
        project: custom((d: { project: string }) => d.project),
        status: custom((d: { status: string }) => d.status),
        output: custom(() => stdout.trim() || "(no output)"),
      },
    ),
    exitCode: 0,
  };
}

async function deploymentDelete(ctx: CommandContext, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  if (wantsHelp(args)) {
    return {
      stdout: renderHelp([
        "Usage: wrangler-axi pages deployment delete <deployment-id> [--project-name <name>] [--force]",
      ]),
      exitCode: 0,
    };
  }
  validateFlags(args, ["--project-name", "--force"], "pages deployment delete");
  // Take value-consuming flags before extracting the positional id.
  const projectName = takeFlag(args, "--project-name");
  const id = args.filter((a) => !a.startsWith("-"))[0];
  if (!id) {
    throw new AxiError("pages deployment delete requires a deployment id", "VALIDATION_ERROR", [
      "Usage: wrangler-axi pages deployment delete <id>",
    ]);
  }
  const wArgs = ["pages", "deployment", "delete", id];
  if (ctx.account) {
    wArgs.push("--account", ctx.account);
  }
  if (projectName) {
    wArgs.push("--project-name", projectName);
  }
  if (takeAllFlags(args, ["--force"]).length > 0) {
    wArgs.push("-f");
  }
  await callWrangler(ctx.runner, wArgs);
  return {
    stdout: renderDetail(
      "deployment",
      { id, status: "deleted" },
      {
        id: custom((d: { id: string }) => d.id),
        status: custom((d: { status: string }) => d.status),
      },
    ),
    exitCode: 0,
  };
}
