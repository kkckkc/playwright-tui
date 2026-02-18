import { readdirSync } from "fs";
import { join, relative } from "path";

export const stripAnsi = (str: string): string => {
  return str.replace(
    // eslint-disable-next-line no-control-regex
    /[\x1B\x9B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
    ""
  );
}

export const getTestFiles = (root: string): string[] => {
  const results: string[] = [];
  const ignored = new Set(["node_modules", ".git", "dist", "build", ".next", "out"]);

  const scan = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignored.has(entry.name) || entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        scan(join(dir, entry.name));
      } else if (
        entry.name.endsWith(".spec.ts") ||
        entry.name.endsWith(".test.ts") ||
        entry.name.endsWith(".spec.js") ||
        entry.name.endsWith(".test.js") ||
        entry.name.endsWith(".spec.mts") ||
        entry.name.endsWith(".test.mts")
      ) {
        results.push(relative(root, join(dir, entry.name)));
      }
    }
  }

  scan(root);
  return results.sort();
}
