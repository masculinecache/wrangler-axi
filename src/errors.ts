import { AxiError, exitCodeForError } from "axi-sdk-js";

export { AxiError, exitCodeForError };

function firstErrorLine(stderr: string): string {
  return stderr.trim().split("\n")[0] ?? "";
}

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

interface ErrorPattern {
  pattern: RegExp;
  code: string;
  message: (match: RegExpMatchArray, stderr: string) => string;
  suggestions?: (match: RegExpMatchArray) => string[];
}

const patterns: ErrorPattern[] = [
  {
    pattern: /set a CLOUDFLARE_API_TOKEN environment variable/i,
    code: "NOT_AUTHENTICATED",
    message: () => "No Cloudflare credentials available in this non-interactive environment",
    suggestions: () => [
      "Set CLOUDFLARE_API_TOKEN in your environment",
      "Run `npx wrangler login` once to authenticate the wrangler CLI",
    ],
  },
  {
    pattern: /You are not authenticated\./i,
    code: "NOT_AUTHENTICATED",
    message: () =>
      "You are not authenticated with Cloudflare",
    suggestions: () => [
      "Set CLOUDFLARE_API_TOKEN in your environment",
      "Run `npx wrangler login` once to authenticate the wrangler CLI",
    ],
  },
  {
    pattern: /Authentication needs a valid API token/i,
    code: "AUTH_INVALID",
    message: (m) => m[0] || "Authentication needs a valid API token",
    suggestions: () => ["Set a valid CLOUDFLARE_API_TOKEN in your environment"],
  },
  {
    pattern: /Unable to find.*(?:namespace|bucket|database|worker|project)/i,
    code: "NOT_FOUND",
    message: (m) => m[0] || "Requested resource was not found",
    suggestions: () => ["Check the resource name and account"],
  },
  {
    pattern: /The specified.*does not exist/i,
    code: "NOT_FOUND",
    message: (m) => m[0] || "Resource does not exist",
  },
  {
    pattern: /not found/i,
    code: "NOT_FOUND",
    message: (m) => m[0] || "Resource not found",
  },
  {
    pattern: /Unknown (?:argument|command)/i,
    code: "VALIDATION_ERROR",
    message: (m) => m[0] || "Unknown argument or command",
    suggestions: () => ["Run `wrangler-axi <command> --help` for valid flags"],
  },
];

/** Translate wrangler stderr + exit code into a structured AxiError. */
export function mapWranglerError(stderr: string, exitCode: number): AxiError {
  // wrangler colorizes its output when it expects a TTY; strip escapes so
  // patterns match and messages stay clean regardless of the environment.
  const clean = stripAnsi(stderr);
  for (const p of patterns) {
    const match = clean.match(p.pattern);
    if (match) {
      return new AxiError(
        p.message(match, clean),
        p.code,
        p.suggestions ? p.suggestions(match) : [],
      );
    }
  }
  const line = firstErrorLine(clean);
  if (/not found/i.test(clean)) {
    return new AxiError(line || "Resource not found", "NOT_FOUND");
  }
  return new AxiError(
    line || `wrangler exited with code ${exitCode}`,
    "UNKNOWN",
  );
}

export function wranglerNotInstalledError(): AxiError {
  return new AxiError(
    "wrangler CLI is not installed — install it via `npm install -g wrangler`",
    "WRANGLER_NOT_INSTALLED",
  );
}
