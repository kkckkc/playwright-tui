# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`playwright-tui` is a terminal user interface (TUI) for interactively running and managing Playwright test suites. It is invoked against an external Playwright project directory and provides a keyboard-driven interface for test discovery, execution, and result visualization.

## Commands

```bash
# Run the TUI against a Playwright project
pnpm start /path/to/playwright/project

# Install Playwright browser (Chromium)
pnpm run pw:install
```

The tool requires `bun` as the runtime (`bun src/index.ts` under the hood). The target project must have a `playwright.config.js/.ts/.mjs/.cjs` and Playwright available at its `node_modules/.bin/playwright`.

## Architecture

The entire application lives in **`src/index.ts`** (single file, ~634 lines). There are no modules, services, or layers — it's one self-contained TUI.

### UI Layout

Built with `@opentui/core`. The layout tree:

```
rootBox (column)
├── headerBox        — title + keyboard hints
├── mainBox (row)
│   ├── leftPanel    — scrollable list of discovered test files (width 40)
│   └── rightPanel   — scrollable real-time test output (flex 1)
└── statusBar        — pass/fail counts and current status
```

Renders at 30 FPS via `createCliRenderer`.

### Key Flows

1. **Test discovery** — `getTestFiles()` recursively finds `*.spec.ts/js/mts` and `*.test.ts/js/mts` files, skipping `node_modules`, `.git`, `dist`, etc.

2. **Test execution** — `runTests()` spawns `playwright test` as a subprocess, streams stdout/stderr, parses ANSI output in real-time to update pass/fail counts and color-code file list entries.

3. **Keyboard bindings**
   - `↑/↓` — navigate file list
   - `Enter` / `r` — run selected test file
   - `R` — run all tests
   - `u` — update snapshots for selected file
   - `g` — open Playwright GUI mode (detached process)
   - `v` — view HTML report
   - `x` — stop running tests
   - `q` / `Ctrl+C` — quit

### Dependencies

- **`@opentui/core`** — TUI rendering (`BoxRenderable`, `TextRenderable`, `ScrollBoxRenderable`, `t`/`fg`/`bold`/`dim` text utilities)
- **`bun`** — runtime (not Node.js)
- **`pnpm`** — package manager
