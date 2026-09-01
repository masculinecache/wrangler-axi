---
name: wrangler-axi
description: Run Cloudflare Wrangler operations through the wrangler-axi TOON wrapper when you need worker deploys, secrets, KV/D1/R2, Pages, or account identity. Use whenever the task touches wrangler, workers, Cloudflare secrets, KV namespaces, D1 databases, R2 buckets, or Pages projects.
---

# wrangler-axi

Agent-ergonomic TOON wrapper around Cloudflare Wrangler 4.x. Outputs compact TOON on stdout (no JSON parsing needed), with definitive empty states, aggregate counts, and structured errors with actionable suggestions.

## Invocation

If the `wrangler-axi` binary is on PATH, run it directly:

```sh
wrangler-axi <area> <sub> [args]
```

Otherwise invoke without a global install:

```sh
npx -y wrangler-axi <area> <sub> [args]
```

Run with no args for the home view; run `wrangler-axi --help` for the full area list.

## Global flags

- `--help` / `-h` — show help (always allowed on every command)
- `--version` / `-v` — print version
- `--account <id|name>` — select the Cloudflare account

Every list supports `--fields <a,b,c>` and `--limit <n>`.

## Commands

```sh
npx -y wrangler-axi whoami                                         # identity / auth state
npx -y wrangler-axi secrets list [--name <worker>]                 # worker secrets
npx -y wrangler-axi secrets put <key> --name <worker>              # value from stdin
npx -y wrangler-axi secrets delete <key> --name <worker>

npx -y wrangler-axi kv namespace list
npx -y wrangler-axi kv key list --namespace-id <id> [--prefix <p>]
npx -y wrangler-axi kv key get <key> --namespace-id <id> [--text]
npx -y wrangler-axi kv key put <key> <value> --namespace-id <id>

npx -y wrangler-axi d1 databases list
npx -y wrangler-axi d1 query <db> --command "SELECT 1" [--remote]

npx -y wrangler-axi r2 bucket list
npx -y wrangler-axi r2 bucket info <name>

npx -y wrangler-axi pages project list
npx -y wrangler-axi pages deployment list --project-name <name>

npx -y wrangler-axi workers deploy [path] [--name <worker>]
npx -y wrangler-axi workers versions list [--name <worker>]
npx -y wrangler-axi workers deployments list [--name <worker>]
npx -y wrangler-axi workers tail [worker] [--max-entries <n>] [--timeout <sec>] [--search <text>] [--status error]
```

## Exit codes

- `0` success (including no-ops / empty results)
- `1` runtime error (not authenticated, not found)
- `2` usage error (unknown flag, missing required flag)

Errors go to stdout in TOON with a suggestion; unknown flags fail loudly and list the valid flags so you can
self-correct in one step. `--help` is always allowed. No command prompts interactively.

## Installation

```sh
npm install -g wrangler-axi
```

Requires Node.js >= 20 and `wrangler` on PATH (`npm install -g wrangler`).

## Integrations

This skill is one of two complementary install paths (see the README). A session hook for Claude Code / Codex /
OpenCode injects live account state at session start instead. Install whichever fits; you only need one.
