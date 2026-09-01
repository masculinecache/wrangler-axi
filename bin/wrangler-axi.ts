#!/usr/bin/env node
import { run } from "../src/cli.js";
import { exitCodeForError } from "../src/errors.js";

const argv = process.argv.slice(2);
const cwd = process.cwd();

run(argv, undefined, cwd)
  .then(({ stdout, exitCode }) => {
    if (stdout) {
      process.stdout.write(stdout + "\n");
    }
    process.exitCode = exitCode;
  })
  .catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`wrangler-axi: ${message}\n`);
    process.exitCode = exitCodeForError(err);
  });
