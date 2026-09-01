import { AxiError } from "./errors.js";
import { getAllFlags } from "./args.js";

/** Global flags that are always allowed on any command. */
const ALWAYS_ALLOWED = ["--help", "-h", "--account"];

/**
 * Validate that every flag present in args is known. Positive short flags like
 * `-J` are checked too. Unknown flags throw VALIDATION_ERROR listing the valid
 * flags so the agent self-corrects in one turn.
 */
export function validateFlags(
  args: string[],
  valid: string[],
  commandName: string,
): void {
  const allowed = [...new Set([...ALWAYS_ALLOWED, ...valid])];
  const present = getAllFlags(args);
  const unknown = present.filter((f) => !allowed.includes(f));
  if (unknown.length > 0) {
    throw new AxiError(
      `Unknown flag(s): ${unknown.join(", ")} for ${commandName}`,
      "VALIDATION_ERROR",
      [
        `Valid flags for ${commandName}: ${allowed
          .filter((f) => f !== "--help" && f !== "-h")
          .join(", ")}`,
        "Run `wrangler-axi --help` or add --help for usage",
      ],
    );
  }
}

/** True if args requests help explicitly (contains --help/-h). Empty args run with defaults. */
export function wantsHelp(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}
