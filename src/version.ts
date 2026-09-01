import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

function readPackageVersion(): string {
  const candidates = [
    join(here, "..", "package.json"),
    join(here, "..", "..", "package.json"),
  ];
  for (const path of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(path, "utf8")) as {
        version?: string;
      };
      if (pkg.version) {
        return pkg.version;
      }
    } catch {
      // try next candidate
    }
  }
  throw new Error("Could not resolve package version for wrangler-axi");
}

export const VERSION: string = readPackageVersion();
