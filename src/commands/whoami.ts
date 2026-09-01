import type { CommandArea, CommandContext } from "../cli.js";
import { callWranglerLenient, parseJson } from "../wrangler.js";
import { takeAllFlags, takeFlag } from "../args.js";
import { validateFlags, wantsHelp } from "../util.js";
import { custom, renderDetail, renderHelp, renderOutput } from "../toon.js";

interface WhoamiJson {
  loggedIn: boolean;
  email?: string;
  account?: {
    id?: string;
    name?: string;
  } | null;
  apiToken?: { email?: string } | null;
  deviceToken?: { email?: string } | null;
}

interface Detail {
  email: string;
  accountId: string;
  accountName: string;
  loggedIn: string;
}

const VALID_FLAGS = ["--json"];

export const whoamiCommand: CommandArea = {
  name: "whoami",
  description: "show the currently authenticated Cloudflare account",
  help: [
    "Usage: wrangler-axi whoami [--json]",
    "Shows which Cloudflare account you are authenticated as.",
    "Flags: --json (raw wrangler JSON output)",
    "Global: --account <id|name>",
    "Example: wrangler-axi whoami",
  ],
  async run(ctx: CommandContext, args: string[]) {
    if (wantsHelp(args)) {
      return { stdout: renderHelp(whoamiCommand.help), exitCode: 0 };
    }
    const json = takeAllFlags(args, ["--json"]).length > 0;
    validateFlags(args, VALID_FLAGS, "whoami");

    const wArgs = ["whoami", "--json"];
    if (ctx.account) {
      wArgs.push("--account", ctx.account);
    }

    const { stdout } = await callWranglerLenient(ctx.runner, wArgs);
    if (json) {
      return { stdout, exitCode: 0 };
    }
    const data = parseJson<WhoamiJson>(stdout, "whoami");

    if (!data.loggedIn) {
      const detail: Detail = {
        email: "not authenticated",
        accountId: "none",
        accountName: "none",
        loggedIn: "no",
      };
      return {
        stdout: renderOutput([
          renderDetail("identity", detail, whoamiSchema),
          renderHelp(["Run `wrangler login` to authenticate"]),
        ]),
        exitCode: 0,
      };
    }

    const detail: Detail = {
      email: data.email ?? data.apiToken?.email ?? data.deviceToken?.email ?? "unknown",
      accountId: data.account?.id ?? "unknown",
      accountName: data.account?.name ?? "unknown",
      loggedIn: "yes",
    };
    return { stdout: renderDetail("identity", detail, whoamiSchema), exitCode: 0 };
  },
};

const whoamiSchema = {
  email: custom((d: Detail) => d.email),
  accountId: custom((d: Detail) => d.accountId),
  accountName: custom((d: Detail) => d.accountName),
  loggedIn: custom((d: Detail) => d.loggedIn),
};
