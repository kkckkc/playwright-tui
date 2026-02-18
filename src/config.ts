import { existsSync } from "fs";
import { resolve, join } from "path";

const targetArg = process.argv[2];
if (!targetArg) {
  console.error("Usage: playwright-tui <path-to-project>");
  console.error("  <path-to-project> must contain a playwright.config.js or playwright.config.ts");
  process.exit(1);
}

export const ROOT = resolve(targetArg);

if (!existsSync(ROOT)) {
  console.error(`Error: directory not found: ${ROOT}`);
  process.exit(1);
}

const hasConfig =
  existsSync(join(ROOT, "playwright.config.js")) ||
  existsSync(join(ROOT, "playwright.config.ts")) ||
  existsSync(join(ROOT, "playwright.config.mjs")) ||
  existsSync(join(ROOT, "playwright.config.cjs"));

if (!hasConfig) {
  console.error(`Error: no playwright.config.js / playwright.config.ts found in ${ROOT}`);
  process.exit(1);
}

export const PLAYWRIGHT_BIN = resolve(ROOT, "node_modules/.bin/playwright");

if (!existsSync(PLAYWRIGHT_BIN)) {
  console.error(`Error: playwright not found at ${PLAYWRIGHT_BIN}`);
  console.error("Make sure node_modules is installed in the target project.");
  process.exit(1);
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
