# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## GitHub credentials

- Every GitHub operation on this repo uses the `masculinecache` account ONLY — never the global `phillias` credentials.
- Every `gh`/`gh-axi` call exports `GH_CONFIG_DIR=$HOME/.config/gh-masculinecache` (the repo `.mise.toml` already sets it for mise-hooked shells).
- `git push`/auth flows through the repo-local credential helper (blank-reset + masculinecache helper); never alter it.
- Any gh auth failure: stop and report blocked; never retry with different credentials.

## npm publish

- Package is published as scoped `@masculinecache/wrangler-axi` with `publishConfig.access: public` (scoped packages default to restricted).
- Publish with a granular token via a temporary `--userconfig` file, then remove it. Never print or commit token values; granular tokens 401 on `npm whoami` by design — validate the registry path with `npm dist-tag ls @masculinecache/wrangler-axi` instead.
- Tag-driven CI publish lives in `.github/workflows/publish.yml` (`npm publish --provenance` on `v*` tags).
- `files` excludes `!dist/test` so compiled tests never ship in the tarball; verify with `npm publish --dry-run`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
