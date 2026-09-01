import { describe, it, expect } from "vitest";
import { run } from "../src/cli.js";
import type { WranglerRunner } from "../src/wrangler.js";

/** Fake runner mapping a canonical wrangler arg-list to a canned stdout. */
function makeRunner(routes: Record<string, { stdout?: string; stderr?: string; exitCode?: number }>): WranglerRunner {
  return {
    async run(args: string[]) {
      const key = args.join(" ");
      const hit = routes[key];
      return {
        stdout: hit?.stdout ?? "",
        stderr: hit?.stderr ?? "",
        exitCode: hit?.exitCode ?? 0,
      };
    },
  };
}

const fixtures = {
  whoamiLoggedIn: JSON.stringify({
    loggedIn: true,
    email: "a@b.c",
    account: { id: "acc1", name: "Acme" },
  }),
  whoamiLoggedOut: JSON.stringify({ loggedIn: false }),
  secrets: JSON.stringify([{ name: "API_KEY", type: "text" }]),
  d1: JSON.stringify([{ name: "db1", id: "11" }]),
  kvNs: JSON.stringify([{ id: "ns1", title: "MyNS" }]),
  kvKeys: JSON.stringify([{ name: "k1", expiration: null }]),
  // wrangler 4.x `r2 bucket list` has no --json: it prints labelled blocks
  // (ANSI-colored when a TTY is attached) — exactly what the wrapper parses.
  r2Human: [
    "Listing buckets...",
    "",
    "\u001b[37mname:\u001b[39m           \u001b[90mb1\u001b[39m",
    "\u001b[37mcreation_date:\u001b[39m  \u001b[90m2024-01-01T00:00:00Z\u001b[39m",
    "",
    "\u001b[37mname:\u001b[39m           \u001b[90mb2\u001b[39m",
    "\u001b[37mcreation_date:\u001b[39m  \u001b[90m2024-02-02T00:00:00Z\u001b[39m",
    "",
  ].join("\n"),
  r2HumanEmpty: "Listing buckets...\n",
  pages: JSON.stringify([{ name: "site", domains: ["x.com"] }]),
  versions: JSON.stringify([{ id: "v1", created_on: "2026-01-01" }]),
};

async function invoke(runner: WranglerRunner, args: string[]) {
  return run(args, runner);
}

describe("dispatch", () => {
  it("prints version", async () => {
    const r = await invoke(makeRunner({}), ["--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("0.1.0");
  });

  it("prints top-level help", async () => {
    const r = await invoke(makeRunner({}), ["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("wrangler-axi <area> <sub>");
    expect(r.stdout).toContain("whoami");
  });

  it("rejects an unknown area with exit 2", async () => {
    const r = await invoke(makeRunner({}), ["bogus"]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toContain("Unknown area");
  });
});

describe("whoami", () => {
  it("renders identity when logged in", async () => {
    const runner = makeRunner({ "whoami --json": { stdout: fixtures.whoamiLoggedIn } });
    const r = await invoke(runner, ["whoami"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("email: a@b.c");
    expect(r.stdout).toContain("accountId: acc1");
    expect(r.stdout).toContain("loggedIn: yes");
  });

  it("renders definitive empty state when logged out", async () => {
    const runner = makeRunner({ "whoami --json": { stdout: fixtures.whoamiLoggedOut } });
    const r = await invoke(runner, ["whoami"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("not authenticated");
  });
});

describe("list commands", () => {
  it("lists secrets", async () => {
    const runner = makeRunner({ "secret list --format json": { stdout: fixtures.secrets } });
    const r = await invoke(runner, ["secrets", "list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("count: 1");
    expect(r.stdout).toContain("API_KEY");
  });

  it("lists d1 databases", async () => {
    const runner = makeRunner({ "d1 list --json": { stdout: fixtures.d1 } });
    const r = await invoke(runner, ["d1", "databases", "list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("db1");
  });

  it("lists kv namespaces (wrangler prints JSON by default)", async () => {
    const runner = makeRunner({ "kv namespace list": { stdout: fixtures.kvNs } });
    const r = await invoke(runner, ["kv", "namespace", "list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("MyNS");
  });

  it("lists kv keys with namespace-id", async () => {
    const runner = makeRunner({ "kv key list --namespace-id ns1": { stdout: fixtures.kvKeys } });
    const r = await invoke(runner, ["kv", "key", "list", "--namespace-id", "ns1"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("k1");
  });

  it("lists r2 buckets parsed from wrangler human output", async () => {
    const runner = makeRunner({ "r2 bucket list": { stdout: fixtures.r2Human } });
    const r = await invoke(runner, ["r2", "bucket", "list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("b1");
    expect(r.stdout).toContain("b2");
    expect(r.stdout).toContain("count: 2");
  });

  it("r2 bucket list --json returns wrapper-side JSON of parsed items", async () => {
    const runner = makeRunner({ "r2 bucket list": { stdout: fixtures.r2Human } });
    const r = await invoke(runner, ["r2", "bucket", "list", "--json"]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toEqual([
      { name: "b1", creation_date: "2024-01-01T00:00:00Z" },
      { name: "b2", creation_date: "2024-02-02T00:00:00Z" },
    ]);
  });

  it("r2 bucket list renders a definitive empty state", async () => {
    const runner = makeRunner({ "r2 bucket list": { stdout: fixtures.r2HumanEmpty } });
    const r = await invoke(runner, ["r2", "bucket", "list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("count: 0");
    expect(r.stdout).toContain("no R2 buckets found");
  });

  it("lists pages projects", async () => {
    const runner = makeRunner({ "pages project list --json": { stdout: fixtures.pages } });
    const r = await invoke(runner, ["pages", "project", "list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("site");
  });

  it("lists workers versions", async () => {
    const runner = makeRunner({ "versions list --json": { stdout: fixtures.versions } });
    const r = await invoke(runner, ["workers", "versions", "list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("v1");
  });

  it("defaults workers versions limit to 20; --full disables it", async () => {
    const many = JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ id: `v${i}`, created_on: "2026-01-01" })));
    const runner = makeRunner({ "versions list --json": { stdout: many } });
    const r = await invoke(runner, ["workers", "versions", "list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("v0");
    expect(r.stdout).toContain("v19");
    expect(r.stdout).not.toContain("v20]");
    const full = await invoke(runner, ["workers", "versions", "list", "--full"]);
    expect(full.exitCode).toBe(0);
    expect(full.stdout).toContain("v24");
  });

  it("defaults workers deployments limit to 20; --full disables it", async () => {
    const many = JSON.stringify(
      Array.from({ length: 25 }, (_, i) => ({ id: `d${i}`, url: `https://d${i}.example.workers.dev`, created_on: "2026-01-01" })),
    );
    const runner = makeRunner({ "deployments list --json": { stdout: many } });
    const r = await invoke(runner, ["workers", "deployments", "list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("d0");
    expect(r.stdout).toContain("d19");
    expect(r.stdout).not.toContain("d20");
    const full = await invoke(runner, ["workers", "deployments", "list", "--full"]);
    expect(full.exitCode).toBe(0);
    expect(full.stdout).toContain("d24");
  });

  it("renders a definitive empty state", async () => {
    const runner = makeRunner({ "secret list --format json": { stdout: "[]" } });
    const r = await invoke(runner, ["secrets", "list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("count: 0");
    expect(r.stdout).toContain("no secrets found");
  });

  it("truncates with --limit and notes it", async () => {
    const many = JSON.stringify([
      { name: "A", type: "text" },
      { name: "B", type: "text" },
      { name: "C", type: "text" },
    ]);
    const runner = makeRunner({ "secret list --format json": { stdout: many } });
    const r = await invoke(runner, ["secrets", "list", "--limit", "2"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("A");
    expect(r.stdout).toContain("B");
    expect(r.stdout).not.toContain("C");
  });
});

describe("validation", () => {
  it("rejects an unknown flag with exit 2 and lists valid flags", async () => {
    const runner = makeRunner({});
    const r = await invoke(runner, ["secrets", "list", "--bogus", "x"]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toContain("Unknown flag");
    expect(r.stdout).toContain("--name");
  });

  it("--help always passes even with an unknown flag present", async () => {
    const runner = makeRunner({});
    const r = await invoke(runner, ["d1", "databases", "list", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Usage");
  });
});

// The README exit-code contract promises exit 2 / VALIDATION_ERROR for every
// usage error: "unknown flag, missing required flag, unknown area". Unknown
// flags and unknown areas already comply; these cases pin the rest of the
// contract (missing required flag, missing required positional, unknown
// subcommand) so an agent can rely on exit 2 to mean "self-correct".
describe("usage-error exit-code contract", () => {
  const expectUsageError = (r: { stdout: string; exitCode: number }, needle: string) => {
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toContain("VALIDATION_ERROR");
    expect(r.stdout).toContain(needle);
  };

  it("kv key list missing --namespace-id/--binding", async () => {
    expectUsageError(await invoke(makeRunner({}), ["kv", "key", "list"]), "namespace-id");
  });

  it("kv key get missing --namespace-id/--binding", async () => {
    expectUsageError(await invoke(makeRunner({}), ["kv", "key", "get", "k1"]), "namespace-id");
  });

  it("kv key get missing key positional", async () => {
    expectUsageError(await invoke(makeRunner({}), ["kv", "key", "get"]), "key");
  });

  it("kv namespace create missing title", async () => {
    expectUsageError(await invoke(makeRunner({}), ["kv", "namespace", "create"]), "title");
  });

  it("d1 query missing --command/--file", async () => {
    expectUsageError(await invoke(makeRunner({}), ["d1", "query", "db"]), "command");
  });

  it("pages deployment list missing --project-name", async () => {
    expectUsageError(await invoke(makeRunner({}), ["pages", "deployment", "list"]), "project-name");
  });

  it("r2 bucket info missing bucket name", async () => {
    expectUsageError(await invoke(makeRunner({}), ["r2", "bucket", "info"]), "bucket");
  });

  it("secrets put missing secret key", async () => {
    expectUsageError(await invoke(makeRunner({}), ["secrets", "put"]), "key");
  });

  it("unknown subcommand under an area", async () => {
    expectUsageError(await invoke(makeRunner({}), ["kv", "bogus"]), "bogus");
    expectUsageError(await invoke(makeRunner({}), ["d1", "bogus"]), "bogus");
  });
});

// Regression: `kv key put k1 --namespace-id ns1` (no value) used to capture the
// namespace-id value as a positional and silently write "ns1" as the VALUE of
// key k1, because positionals were filtered before value-consuming flags were
// taken. The runner must never be invoked with a trailing namespace-id value,
// and the missing value must surface as a clear VALIDATION_ERROR.
describe("kv key put positional extraction", () => {
  function recordingRunner(): { runner: WranglerRunner; received: () => string[] | undefined } {
    let received: string[] | undefined;
    const runner: WranglerRunner = {
      async run(args: string[]) {
        received = args;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };
    return { runner, received: () => received };
  }

  it("rejects a missing value/path instead of writing the namespace-id as the value", async () => {
    const { runner, received } = recordingRunner();
    const r = await invoke(runner, ["kv", "key", "put", "k1", "--namespace-id", "ns1"]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toContain("VALIDATION_ERROR");
    expect(r.stdout).toContain("value");
    // wrangler must not have been invoked at all (no silent corrupt write).
    expect(received()).toBeUndefined();
  });

  it("writes the explicit value positional, never the namespace-id", async () => {
    const { runner, received } = recordingRunner();
    const r = await invoke(runner, ["kv", "key", "put", "k1", "v1", "--namespace-id", "ns1"]);
    expect(r.exitCode).toBe(0);
    expect(received()).toEqual(["kv", "key", "put", "k1", "--namespace-id", "ns1", "v1"]);
    // the value is the trailing positional and must be the intended "v1"
    expect(received()?.at(-1)).toBe("v1");
  });

  it("forwards --path and does not push a value positional", async () => {
    const { runner, received } = recordingRunner();
    const r = await invoke(runner, ["kv", "key", "put", "k1", "--path", "file.txt", "--namespace-id", "ns1"]);
    expect(r.exitCode).toBe(0);
    expect(received()).toEqual(["kv", "key", "put", "k1", "--namespace-id", "ns1", "--path", "file.txt"]);
  });
});

// Regression: wrangler 4.x rejects `--json` on `kv namespace create`,
// `pages project create` (human output only), and `r2 bucket list` /
// `kv namespace list` (JSON by default / human output). The wrapper must
// never forward `--json` to those commands; `--json` stays a wrapper-side
// escape hatch synthesized from known inputs or parsed output.
describe("wrangler --json incompatibility", () => {
  function argRecordingRunner(stdout = ""): { runner: WranglerRunner; received: () => string[] | undefined } {
    let received: string[] | undefined;
    const runner: WranglerRunner = {
      async run(args: string[]) {
        received = args;
        return { stdout, stderr: "", exitCode: 0 };
      },
    };
    return { runner, received: () => received };
  }

  it("kv namespace create renders a detail and never passes --json", async () => {
    const { runner, received } = argRecordingRunner("🌀 Creating namespace...\n✨ Success!");
    const r = await invoke(runner, ["kv", "namespace", "create", "MyNS"]);
    expect(r.exitCode).toBe(0);
    expect(received()).toEqual(["kv", "namespace", "create", "MyNS"]);
    expect(r.stdout).toContain("MyNS");
    expect(r.stdout).toContain("created");
  });

  it("kv namespace create --json emits wrapper-side JSON", async () => {
    const { runner, received } = argRecordingRunner("✨ Success!");
    const r = await invoke(runner, ["kv", "namespace", "create", "MyNS", "--json"]);
    expect(r.exitCode).toBe(0);
    expect(received()).toEqual(["kv", "namespace", "create", "MyNS"]);
    expect(JSON.parse(r.stdout)).toEqual({ title: "MyNS", status: "created" });
  });

  it("pages project create renders a detail and never passes --json", async () => {
    const { runner, received } = argRecordingRunner("✨ Success!");
    const r = await invoke(runner, ["pages", "project", "create", "site"]);
    expect(r.exitCode).toBe(0);
    expect(received()).toEqual(["pages", "project", "create", "site"]);
    expect(r.stdout).toContain("site");
    expect(r.stdout).toContain("created");
  });

  it("pages project create --json emits wrapper-side JSON", async () => {
    const { runner, received } = argRecordingRunner("✨ Success!");
    const r = await invoke(runner, ["pages", "project", "create", "site", "--json"]);
    expect(r.exitCode).toBe(0);
    expect(received()).toEqual(["pages", "project", "create", "site"]);
    expect(JSON.parse(r.stdout)).toEqual({ name: "site", status: "created" });
  });
});

describe("error mapping", () => {
  it("whoami tolerates exit 1 with a logged-out JSON body", async () => {
    const runner = makeRunner({
      "whoami --json": { stdout: fixtures.whoamiLoggedOut, stderr: "", exitCode: 1 },
    });
    const r = await invoke(runner, ["whoami"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("not authenticated");
  });

  it("maps unknown argument stderr to VALIDATION_ERROR", async () => {
    const runner = makeRunner({
      "secret list --format json": { stderr: "Unknown argument: --bogus", exitCode: 2, stdout: "" },
    });
    const r = await invoke(runner, ["secrets", "list"]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toContain("VALIDATION_ERROR");
  });

  it("strips ANSI and maps the non-interactive token error", async () => {
    const runner = makeRunner({
      "kv namespace list": {
        stderr:
          "\u001b[31m✘ \u001b[41;31m[\u001b[41;97mERROR\u001b[41;31m]\u001b[0m In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable for wrangler to work.\u001b[0m",
        exitCode: 1,
        stdout: "",
      },
    });
    const r = await invoke(runner, ["kv", "namespace", "list"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("NOT_AUTHENTICATED");
    expect(r.stdout).not.toContain("\u001b[");
    expect(r.stdout).toContain("CLOUDFLARE_API_TOKEN");
  });
});

describe("account global", () => {
  it("forwards --account to whoami", async () => {
    let received: string[] = [];
    const runner: WranglerRunner = {
      async run(args: string[]) {
        received = args;
        return { stdout: fixtures.whoamiLoggedIn, stderr: "", exitCode: 0 };
      },
    };
    await invoke(runner, ["whoami", "--account", "acme"]);
    expect(received).toEqual(["whoami", "--json", "--account", "acme"]);
  });
});

const tailFixtures = {
  logLine: JSON.stringify({
    event: { type: "log", message: "hello world", outcome: "ok" },
    eventType: "log",
    outcome: "ok",
  }),
  requestLine: JSON.stringify({
    event: { type: "request", request: { method: "GET", url: "https://example.com/x" }, outcome: "ok" },
    eventType: "request",
    outcome: "ok",
  }),
  exceptionLine: JSON.stringify({
    event: { type: "exception", exception: { name: "InternalError", message: "boom" }, message: "boom", outcome: "error" },
    eventType: "exception",
    outcome: "error",
  }),
};

/**
 * Fake streaming runner: returns the canned lines, bounded by maxEntries, and
 * reports the requested stoppedBy. Captures the wrangler args if `record` set.
 */
function makeTailRunner(
  lines: string[],
  opts?: {
    exitCode?: number;
    stderr?: string;
    stoppedBy?: "limit" | "timeout" | "exit";
    record?: (args: string[]) => void;
  },
): WranglerRunner {
  return {
    async run() {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    async tail(t) {
      opts?.record?.(t.args);
      return {
        entries: t.maxEntries > 0 ? lines.slice(0, t.maxEntries) : lines,
        stderr: opts?.stderr ?? "",
        stoppedBy: opts?.stoppedBy ?? "limit",
        exitCode: opts?.exitCode ?? 0,
      };
    },
  };
}

describe("workers tail", () => {
  it("renders each event as a compact row with a count and bound hint", async () => {
    const runner = makeTailRunner([
      tailFixtures.logLine,
      tailFixtures.requestLine,
      tailFixtures.exceptionLine,
    ]);
    const r = await invoke(runner, ["workers", "tail", "my-worker"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("count: 3");
    expect(r.stdout).toContain("GET https://example.com/x");
    expect(r.stdout).toContain("hello world");
    expect(r.stdout).toContain("InternalError: boom");
    expect(r.stdout).toContain("stopped at --max-entries 20");
  });

  it("stops at --max-entries and notes the truncation", async () => {
    const runner = makeTailRunner([
      tailFixtures.logLine,
      tailFixtures.requestLine,
      tailFixtures.exceptionLine,
    ]);
    const r = await invoke(runner, ["workers", "tail", "--max-entries", "2"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("count: 2 (showing first 2)");
    expect(r.stdout).toContain("stopped at --max-entries 2");
    expect(r.stdout).not.toContain("InternalError");
  });

  it("reports a --timeout stop hint", async () => {
    const runner = makeTailRunner([tailFixtures.logLine], { stoppedBy: "timeout" });
    const r = await invoke(runner, ["workers", "tail", "--timeout", "3"]);
    expect(r.stdout).toContain("stopped after 3s (--timeout)");
  });

  it("prints a definitive empty state", async () => {
    const runner = makeTailRunner([], { stoppedBy: "timeout" });
    const r = await invoke(runner, ["workers", "tail"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("count: 0");
    expect(r.stdout).toContain("no log events");
  });

  it("--json escape returns raw bounded lines", async () => {
    const runner = makeTailRunner([tailFixtures.logLine, tailFixtures.requestLine]);
    const r = await invoke(runner, ["workers", "tail", "--json"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('"eventType":"log"');
    expect(r.stdout).toContain('"eventType":"request"');
  });

  it("forwards worker and filters to wrangler tail", async () => {
    let received: string[] | undefined;
    const runner = makeTailRunner([tailFixtures.logLine], {
      record: (a) => {
        received = a;
      },
    });
    await invoke(runner, [
      "workers", "tail", "my-worker",
      "--search", "error", "--status", "error",
      "--method", "GET", "--ip", "1.2.3.4",
      "--max-entries", "1", "--timeout", "3",
    ]);
    expect(received).toEqual([
      "tail", "--format", "json",
      "--search", "error", "--status", "error",
      "--method", "GET", "--ip", "1.2.3.4",
      "my-worker",
    ]);
  });

  it("forwards --account into the tail args", async () => {
    let received: string[] | undefined;
    const runner = makeTailRunner([tailFixtures.logLine], {
      record: (a) => {
        received = a;
      },
    });
    await invoke(runner, ["workers", "tail", "--account", "acct1"]);
    expect(received).toEqual(["tail", "--format", "json", "--account", "acct1"]);
  });

  it("rejects a run with no bound at all", async () => {
    const runner = makeTailRunner([tailFixtures.logLine]);
    const r = await invoke(runner, ["workers", "tail", "--max-entries", "0", "--timeout", "0"]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toContain("VALIDATION_ERROR");
  });

  it("maps a failed stream to a structured exit", async () => {
    const runner = makeTailRunner([], {
      stderr: "You are not authenticated.",
      exitCode: 1,
      stoppedBy: "exit",
    });
    const r = await invoke(runner, ["workers", "tail"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("NOT_AUTHENTICATED");
  });

  it("tail help lists bound and filter flags", async () => {
    const runner = makeTailRunner([]);
    const r = await invoke(runner, ["workers", "tail", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("--max-entries");
    expect(r.stdout).toContain("--status");
  });

  it("rejects an unknown tail flag with exit 2", async () => {
    const runner = makeTailRunner([]);
    const r = await invoke(runner, ["workers", "tail", "--bogus", "1"]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toContain("Unknown flag");
  });
});
