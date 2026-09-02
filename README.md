# wrangler-axi

Agent-ergonomic TOON wrapper around [Cloudflare Wrangler](https://developers.cloudflare.com/workers/wrangler/) 4.x.

`wrangler-axi` is a thin, [AXI](https://toonformat.dev/)-compliant CLI that wraps the `wrangler` binary and emits
[TOON](https://toonformat.dev/) on stdout — compact, token-efficient output that agents can consume without a
JSON-parsing round trip. It stays close to Wrangler's own command surface: anything you can do with `wrangler`
you can do with `wrangler-axi`, plus predictable list schemas, definitive empty states, aggregate counts, and
structured errors with actionable suggestions.

## Install

```sh
npm install -g @masculinecache/wrangler-axi
```

Requires Node.js >= 20 and the `wrangler` binary available on `PATH` (install it with `npm install -g wrangler`).

## Usage

```
wrangler-axi <area> <sub> [args]
```

Run with no arguments to see the home view.

```
$ wrangler-axi --help
```

### Global flags

| Flag | Meaning |
| --- | --- |
| `--help`, `-h` | Show help (always allowed on every command) |
| `--version`, `-v` | Print the wrangler-axi version |
| `--account <id\|name>` | Select the Cloudflare account (forwarded to wrangler) |

Every list command supports `--fields <a,b,c>` to request extra columns and `--limit <n>` to cap rows. `workers versions list` and `workers deployments list` default to `--limit 20` when neither `--limit` nor `--full` is given; `--full` removes the cap.

## Areas

### `whoami`

Report the authenticated identity.

```
$ wrangler-axi whoami
identity:
  email: a@b.c
  accountId: acc1
  accountName: Acme
  loggedIn: yes
```

When logged out it reports `not authenticated` with help to run `wrangler login`.

### `secrets`

| Sub | Wrangler command | Notes |
| --- | --- | --- |
| `list [--name <worker>]` | `secret list --format json` | |
| `put <key> [--name <worker>]` | `secret put <key> --quiet` | value read from stdin |
| `delete <key> [--name <worker>] [--force]` | `secret delete` | |

### `kv`

| Sub | Wrangler command |
| --- | --- |
| `namespace list` | `kv namespace list` |
| `namespace create <title>` | `kv namespace create` |
| `namespace delete <id>` | `kv namespace delete` |
| `namespace rename <old>` | `kv namespace rename` |
| `key list --namespace-id <id>\|--binding <b> [--prefix]` | `kv key list` |
| `key get <key> --namespace-id <id>\|--binding <b> [--text]` | `kv key get` |
| `key put <key> <value\|--path <p>> --namespace-id <id>\|--binding <b>` | `kv key put` |

### `d1`

| Sub | Wrangler command | Notes |
| --- | --- | --- |
| `databases list` | `d1 list --json` | |
| `query <database> --command <sql>\|--file <f> [--remote] [--yes] [--json]` | `d1 execute` | requires `--command` or `--file` |

### `r2`

| Sub | Wrangler command |
| --- | --- |
| `bucket list` | `r2 bucket list` (human output parsed) |
| `bucket info <name>` | `r2 bucket info --json` |
| `bucket create <name>` | `r2 bucket create` |
| `bucket delete <name>` | `r2 bucket delete` |
| `object get/put/delete <path>` | `r2 object ...` |

### `pages`

| Sub | Wrangler command | Notes |
| --- | --- | --- |
| `project list` | `pages project list --json` | |
| `project create <name>` | `pages project create` | |
| `project delete <name>` | `pages project delete` | |
| `deployment list --project-name <n> [--environment <prod\|preview>]` | `pages deployment list --json` | |
| `deployment create [dir] [--project-name <n>]` | `pages deployment create` | |
| `deployment delete <id>` | `pages deployment delete` | |

### `workers`

| Sub | Wrangler command |
| --- | --- |
| `deploy [path]` | `workers deploy` |
| `versions list [--name <worker>]` | `versions list --json` |
| `deployments list [--name <worker>]` | `deployments list --json` |
| `tail [worker] [--max-entries <n>] [--timeout <sec>]` | `tail --format json` (bounded stream) |

`workers tail` streams live Worker logs with a hard bound and never leaves an
interactive session behind: it stops at `--max-entries` (default 20) or
`--timeout` seconds (default 15), then reports which bound fired. Pass-through
filters `--search`, `--status`, `--method`, `--ip`, `--sampling-rate`,
`--header`, and `--version-id` narrow the stream; `--json` returns the raw
bounded lines instead of the compact TOON rows.

`workers deploy` forwards the common single-value, repeatable, and boolean flags from `wrangler deploy`
(`--name`, `--tag`, `--message`, `--compatibility-date`, `--assets`, `--outdir`, `--outfile`, `--tsconfig`,
`--secrets-file`, `--dispatch-namespace`, `--compatibility-flags`, `--var`, `--define`, `--alias`, `--routes`,
`--domains`, `--triggers`, `--no-bundle`, `--latest`, `--minify`, `--dry-run`, `--keep-vars`, `--strict`,
`--autoconfig`).

## Output

Structured data is emitted as TOON on **stdout**.

```
$ wrangler-axi secrets list
count: 1
secrets[1]{name,type}:
  API_KEY,text
```

Errors also go to stdout, in a structured form with an actionable suggestion, and map to a stable exit code:

| Exit | Meaning |
| --- | --- |
| `0` | success (including no-ops and empty results) |
| `1` | runtime error (e.g. not authenticated, not found) |
| `2` | usage error (unknown flag, missing required flag, unknown area) |

```
$ wrangler-axi secrets list --bogus x
error: unknown flag --bogus for `secrets list`
help: valid flags for `secrets list`: --name, --limit (--help always allowed)
```
(exit 2)

Unknown flags fail loudly and list the valid flags so the agent self-corrects in one step. `--help` is always
allowed. No command prompts interactively — every operation is completable with flags alone.

`wrangler-axi` never runs live mutations without being asked, and it never leaks raw dependency stack traces:
wrangler errors are translated into the structured error format above.

## Integrations

`wrangler-axi` follows the AXI ambient-context pattern and offers two complementary ways to surface state to an
agent at session start. Install whichever fits; you only need one.

### Session hook (recommended for Claude Code, Codex, OpenCode)

- **OpenCode**: managed plugin under `~/.config/opencode/plugins/` injecting a compact home-view dashboard
  (bin path + description + live `whoami`/account state) as ambient system context.
- **Claude Code**: `SessionStart` hook in `~/.claude/settings.json` (or project `.claude/settings.json`).
- **Codex**: `SessionStart` hook in `~/.codex/hooks.json` with `[features].hooks = true`.

### Installable skill

A static skill that loads on demand when an agent recognizes a wrangler task — lower overhead, works in any
agent that supports the Agent Skill format:

```sh
npx skills add masculinecache/wrangler-axi --skill wrangler-axi
```

The skill is generated from the same content as the home view so it stays in sync with the CLI.

## Development

```sh
npm install
npm run build       # tsc
npm test            # vitest (all tests use an injected fake runner; no live APIs)
```

## License

MIT
