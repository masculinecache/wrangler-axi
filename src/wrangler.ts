import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { AxiError } from "./errors.js";
import { mapWranglerError } from "./errors.js";
import { wranglerNotInstalledError } from "./errors.js";

/** Cap on captured stdout, mirroring execFile's maxBuffer contract. */
const MAX_OUTPUT = 64 * 1024 * 1024;

/** Result of a single wrangler invocation. */
export interface WranglerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Options for a bounded `wrangler tail` session. */
export interface TailRunOptions {
  /** Full wrangler args (the command itself is `tail --format json ...`). */
  args: string[];
  /** Stop after this many log lines (0 = unbounded; a timeout is then required). */
  maxEntries: number;
  /** Stop the stream after this many milliseconds (0 = no timeout). */
  timeoutMs: number;
}

/** Result of a bounded tail session. Entries are raw JSON lines from stdout. */
export interface TailResult {
  entries: string[];
  stderr: string;
  stoppedBy: "limit" | "timeout" | "exit";
  exitCode: number;
}

/**
 * A wrangler runner. Production uses the real CLI via execFile/spawn; tests
 * inject a fake runner so no live API/shell calls happen.
 */
export interface WranglerRunner {
  run(args: string[], options?: { input?: string }): Promise<WranglerResult>;
  /**
   * Stream `wrangler tail` output with a bound (line and/or time). Optional so
   * minimal fake runners only need `run`; the tail command fails loudly (not
   * silently degrading) if a runner does not implement it.
   */
  tail?(opts: TailRunOptions): Promise<TailResult>;
}

/**
 * Run the real `wrangler` binary with the given args, capturing stdout/stderr.
 * Uses spawn (not execFile) because stdin input must be written explicitly:
 * async `execFile` silently ignores an `input` option and hangs the child.
 * Throws a NO_SUCH_FILE error if wrangler isn't on PATH.
 */
async function runWrangler(args: string[], options?: { input?: string }): Promise<WranglerResult> {
  return new Promise<WranglerResult>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("wrangler", args, { windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let overflow = false;
    const finish = (exitCode: number) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ stdout, stderr, exitCode });
    };
    child.on("error", (err) => {
      if (settled) {
        return;
      }
      settled = true;
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        reject(wranglerNotInstalledError());
      } else {
        reject(err);
      }
    });
    child.on("close", (code) => finish(overflow ? 1 : (code ?? 0)));
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
      if (!overflow && stdout.length > MAX_OUTPUT) {
        overflow = true;
        stderr += "wrangler-axi: output exceeded 64 MiB and was truncated";
        child.kill("SIGKILL");
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    // EPIPE is expected when wrangler exits before draining stdin (e.g. an
    // auth error on `secret put`); the exit code already carries the failure.
    child.stdin?.on("error", () => {});
    if (options?.input !== undefined) {
      child.stdin?.end(options.input);
    } else {
      child.stdin?.end();
    }
  });
}

/**
 * Execute a command against wrangler, mapping failures into structured
 * AxiErrors (validated, then translated). Wranger writes human output to
 * stdout; on non-zero exit the stderr is translated to a structured error.
 */
export async function callWrangler(
  runner: WranglerRunner,
  args: string[],
  options?: { input?: string },
): Promise<{ stdout: string; exitCode: number }> {
  const result = await runner.run(args, options);
  if (result.exitCode !== 0) {
    throw mapWranglerError(result.stderr || result.stdout, result.exitCode);
  }
  return { stdout: result.stdout, exitCode: result.exitCode };
}

/**
 * Execute a command against wrangler without treating a non-zero exit as a
 * failure — used where wrangler emits usable stdout yet still exits non-zero
 * (e.g. `whoami --json` returns exit 1 with `{"loggedIn":false}` when logged
 * out). The caller is responsible for interpreting the result.
 */
export async function callWranglerLenient(
  runner: WranglerRunner,
  args: string[],
  options?: { input?: string },
): Promise<{ stdout: string; exitCode: number }> {
  const result = await runner.run(args, options);
  return { stdout: result.stdout, exitCode: result.exitCode };
}

/** Parse a wrangler JSON output string, failing with a structured error. */
export function parseJson<T>(stdout: string, what: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new AxiError(
      `Could not parse ${what} from wrangler output`,
      "UNKNOWN",
      ["Run with --json to get machine-readable output"],
    );
  }
}

/**
 * Stream `wrangler tail --format json` and stop at the configured bound (max
 * lines or timeout), then SIGTERM the child so the session ends like Ctrl+C.
 * On entry, resolves with the captured raw lines and why the stream stopped.
 */
async function runTail(opts: TailRunOptions): Promise<TailResult> {
  return new Promise<TailResult>((resolve, reject) => {
    let child;
    try {
      child = spawn("wrangler", opts.args, { windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }
    const entries: string[] = [];
    let stderrBuf = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (stoppedBy: TailResult["stoppedBy"], exitCode = 0) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (!child.killed) {
        try {
          child.kill("SIGTERM");
        } catch {
          // already gone
        }
      }
      resolve({ entries, stderr: stderrBuf, stoppedBy, exitCode });
    };

    if (opts.timeoutMs > 0) {
      timer = setTimeout(() => finish("timeout"), opts.timeoutMs);
    }

    child.on("error", (err) => {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        settled = true;
        reject(wranglerNotInstalledError());
      } else {
        settled = true;
        reject(err);
      }
    });

    child.on("close", (code) => {
      finish("exit", code ?? 0);
    });

    child.stderr?.on("data", (chunk) => {
      stderrBuf += String(chunk);
    });

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        const trimmed = line.replace(/\s+$/, "");
        if (!trimmed) {
          return;
        }
        entries.push(trimmed);
        if (opts.maxEntries > 0 && entries.length >= opts.maxEntries) {
          finish("limit");
        }
      });
    }
  });
}

/** Default production runner — always talks to the real wrangler. */
export const realRunner: WranglerRunner = { run: runWrangler, tail: runTail };
