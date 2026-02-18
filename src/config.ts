import { existsSync } from "fs";
import { resolve, join, basename } from "path";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: playwright-tui <path-to-project> [<path-to-project> ...]");
  console.error("  Each <path-to-project> must contain a playwright.config.js or playwright.config.ts");
  process.exit(1);
}

export const PROJECTS: Array<{ root: string; playwrightBin: string; label: string }> = [];

for (const arg of args) {
  const root = resolve(arg);

  if (!existsSync(root)) {
    console.error(`Error: directory not found: ${root}`);
    process.exit(1);
  }

  const hasConfig =
    existsSync(join(root, "playwright.config.js")) ||
    existsSync(join(root, "playwright.config.ts")) ||
    existsSync(join(root, "playwright.config.mjs")) ||
    existsSync(join(root, "playwright.config.cjs"));

  if (!hasConfig) {
    console.error(`Error: no playwright.config.js / playwright.config.ts found in ${root}`);
    process.exit(1);
  }

  const playwrightBin = resolve(root, "node_modules/.bin/playwright");

  if (!existsSync(playwrightBin)) {
    console.error(`Error: playwright not found at ${playwrightBin}`);
    console.error("Make sure node_modules is installed in the target project.");
    process.exit(1);
  }

  PROJECTS.push({ root, playwrightBin, label: basename(root) });
}

export const COLORS = {
  bg: "#0d1117",
  bgPanel: "#161b22",
  border: "#30363d",
  text: "#c9d1d9",
  muted: "#8b949e",
  green: "#7ee787",
  red: "#f85149",
  yellow: "#e3b341",
  blue: "#58a6ff",
  selectedBg: "#1f6feb",
};
