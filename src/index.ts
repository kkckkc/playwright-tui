import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  ScrollBoxRenderable,
  type SelectOption,
  t,
  fg,
  bold,
  dim,
} from "@opentui/core";
import { spawn, type ChildProcess } from "child_process";
import { readdirSync, existsSync } from "fs";
import { resolve, join, relative } from "path";

// ── Constants ────────────────────────────────────────────────────────────────

const targetArg = process.argv[2];
if (!targetArg) {
  console.error("Usage: playwright-tui <path-to-project>");
  console.error("  <path-to-project> must contain a playwright.config.js or playwright.config.ts");
  process.exit(1);
}

const ROOT = resolve(targetArg);

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

const PLAYWRIGHT_BIN = resolve(ROOT, "node_modules/.bin/playwright");

if (!existsSync(PLAYWRIGHT_BIN)) {
  console.error(`Error: playwright not found at ${PLAYWRIGHT_BIN}`);
  console.error("Make sure node_modules is installed in the target project.");
  process.exit(1);
}

const COLORS = {
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripAnsi(str: string): string {
  return str.replace(
    // eslint-disable-next-line no-control-regex
    /[\x1B\x9B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
    ""
  );
}

function getTestFiles(): string[] {
  const results: string[] = [];
  const ignored = new Set(["node_modules", ".git", "dist", "build", ".next", "out"]);

  function scan(dir: string) {
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
        results.push(relative(ROOT, join(dir, entry.name)));
      }
    }
  }

  scan(ROOT);
  return results.sort();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false, // handled manually so we can kill subprocesses
    targetFps: 30,
  });

  function quit(code = 0) {
    currentProcess?.kill();
    renderer.destroy();
    process.exit(code);
  }

  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    quit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    quit(1);
  });

  renderer.setBackgroundColor(COLORS.bg);

  const testFiles = getTestFiles();

  // ── Runtime state ─────────────────────────────────────────────────────────
  let running = false;
  let passCount = 0;
  let failCount = 0;
  let currentProcess: ChildProcess | null = null;
  let outputLineId = 0;

  // ── Layout tree ──────────────────────────────────────────────────────────
  //
  //  renderer.root
  //  └── rootBox   [column]
  //      ├── headerBox   [row, height 3]
  //      ├── mainBox     [row, flexGrow 1]
  //      │   ├── leftPanel  [column, width 40]
  //      │   │   ├── fileSelect  [flexGrow 1]
  //      │   │   └── hintBox     [height 7]
  //      │   └── rightPanel [column, flexGrow 1]
  //      │       └── outputScroll [flexGrow 1]
  //      └── statusBar  [row, height 3]

  const rootBox = new BoxRenderable(renderer, {
    id: "root",
    width: "100%",
    height: "100%",
    flexDirection: "column",
  });
  renderer.root.add(rootBox);

  // ── Header ────────────────────────────────────────────────────────────────

  const headerBox = new BoxRenderable(renderer, {
    id: "header",
    width: "100%",
    height: 3,
    backgroundColor: COLORS.bgPanel,
    border: true,
    borderStyle: "rounded",
    borderColor: COLORS.border,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 2,
    gap: 3,
  });
  rootBox.add(headerBox);

  headerBox.add(
    new TextRenderable(renderer, {
      id: "header-title",
      content: t`${bold(fg(COLORS.green)("Playwright TUI"))}`,
    })
  );
  headerBox.add(
    new TextRenderable(renderer, {
      id: "header-hint",
      content: t`${dim(
        fg(COLORS.muted)(
          "↑↓ navigate · r run · a run all · x stop · q quit"
        )
      )}`,
    })
  );

  // ── Main area ─────────────────────────────────────────────────────────────

  const mainBox = new BoxRenderable(renderer, {
    id: "main",
    flexGrow: 1,
    flexDirection: "row",
  });
  rootBox.add(mainBox);

  // ── Left panel ────────────────────────────────────────────────────────────

  const leftPanel = new BoxRenderable(renderer, {
    id: "left-panel",
    width: 40,
    flexShrink: 0,
    flexDirection: "column",
    border: true,
    borderStyle: "rounded",
    borderColor: COLORS.border,
    title: " Test Files ",
    titleAlignment: "center",
  });
  mainBox.add(leftPanel);

  const selectOptions: SelectOption[] = [
    {
      name: "▶  Run All Tests",
      description: "",
      value: "__all__",
    },
    ...testFiles.map((f) => ({
      name: `   ${f}`,
      description: "",
      value: f,
    })),
  ];

  const fileSelect = new SelectRenderable(renderer, {
    id: "file-select",
    flexGrow: 1,
    options: selectOptions,
    backgroundColor: COLORS.bg,
    focusedBackgroundColor: COLORS.bg,
    textColor: COLORS.text,
    focusedTextColor: COLORS.text,
    selectedBackgroundColor: COLORS.selectedBg,
    selectedTextColor: "#ffffff",
    showDescription: false,
    wrapSelection: true,
  });
  leftPanel.add(fileSelect);

  // Keyboard hints at the bottom of the left panel
  const hintBox = new BoxRenderable(renderer, {
    id: "hints",
    width: "100%",
    height: 7,
    border: ["top"],
    borderStyle: "single",
    borderColor: COLORS.border,
    paddingLeft: 2,
    paddingTop: 1,
    flexDirection: "column",
  });
  leftPanel.add(hintBox);

  for (const [key, desc] of [
    ["r / ↵", "run selected file"],
    ["a    ", "run all tests"],
    ["x    ", "stop running"],
    ["q    ", "quit"],
  ]) {
    hintBox.add(
      new TextRenderable(renderer, {
        id: `hint-${key.trim()}`,
        content: t`${bold(fg(COLORS.blue)(key))}  ${dim(fg(COLORS.muted)(desc))}`,
      })
    );
  }

  // ── Right panel (output) ──────────────────────────────────────────────────

  const rightPanel = new BoxRenderable(renderer, {
    id: "right-panel",
    flexGrow: 1,
    flexDirection: "column",
  });
  mainBox.add(rightPanel);

  const outputScroll = new ScrollBoxRenderable(renderer, {
    id: "output",
    flexGrow: 1,
    stickyScroll: true,
    stickyStart: "bottom",
    border: true,
    borderStyle: "rounded",
    borderColor: COLORS.border,
    title: " Output ",
    titleAlignment: "left",
    contentOptions: {
      backgroundColor: COLORS.bg,
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 1,
    },
  });
  rightPanel.add(outputScroll);

  // ── Status bar ────────────────────────────────────────────────────────────

  const statusBar = new BoxRenderable(renderer, {
    id: "status-bar",
    width: "100%",
    height: 3,
    backgroundColor: COLORS.bgPanel,
    border: true,
    borderStyle: "rounded",
    borderColor: COLORS.border,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 2,
    paddingRight: 2,
    gap: 3,
  });
  rootBox.add(statusBar);

  const statusText = new TextRenderable(renderer, {
    id: "status-msg",
    content: t`${dim(fg(COLORS.muted)("Ready — select a test and press r"))}`,
    flexGrow: 1,
  });
  statusBar.add(statusText);

  const passLabel = new TextRenderable(renderer, {
    id: "pass-count",
    content: t`${bold(fg(COLORS.green)("✓ 0 passed"))}`,
  });
  statusBar.add(passLabel);

  const failLabel = new TextRenderable(renderer, {
    id: "fail-count",
    content: t``,
  });
  statusBar.add(failLabel);

  // ── Output helpers ────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function appendOutput(content: any) {
    const id = `out-${outputLineId++}`;
    outputScroll.add(new TextRenderable(renderer, { id, content }));
  }

  function updateCounts() {
    passLabel.content = t`${bold(fg(COLORS.green)(`✓ ${passCount} passed`))}`;
    failLabel.content = failCount > 0
      ? t`${bold(fg(COLORS.red)(`✗ ${failCount} failed`))}`
      : t``;
  }

  function clearOutput() {
    outputLineId = 0;
    const children = [...outputScroll.getChildren()];
    for (const child of children) {
      outputScroll.remove(child.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (child as any).destroyRecursively?.() ?? (child as any).destroy?.();
    }
  }

  function colorizeLine(raw: string): unknown {
    const line = stripAnsi(raw);
    if (/✓|passed|PASS\b/.test(line)) return t`${fg(COLORS.green)(line)}`;
    if (/✗|✘|×|FAIL\b|Error:/.test(line)) return t`${fg(COLORS.red)(line)}`;
    if (/^\s+\d+ passed/.test(line))
      return t`${bold(fg(COLORS.green)(line))}`;
    if (/^\s+\d+ failed/.test(line)) return t`${bold(fg(COLORS.red)(line))}`;
    if (/Running|Connecting|chromium|webkit|firefox/.test(line))
      return t`${fg(COLORS.yellow)(line)}`;
    return t`${fg(COLORS.muted)(line)}`;
  }

  function processLine(raw: string, isStderr = false) {
    const clean = stripAnsi(raw);
    if (!clean.trim()) return;

    // Extract pass/fail counts from the summary line
    const pm = clean.match(/(\d+) passed/);
    const fm = clean.match(/(\d+) failed/);
    if (pm) passCount = parseInt(pm[1]);
    if (fm) failCount = parseInt(fm[1]);
    updateCounts();

    appendOutput(isStderr ? t`${fg(COLORS.red)(clean)}` : colorizeLine(raw));
  }

  // ── Test runner ───────────────────────────────────────────────────────────

  function runTests(file: string | null) {
    if (running) {
      appendOutput(
        t`${fg(COLORS.yellow)("Already running — press x to stop")}`
      );
      return;
    }

    running = true;
    passCount = 0;
    failCount = 0;
    clearOutput();

    const label = file ?? "all tests";
    const divider = t`${dim(fg(COLORS.border)("─".repeat(60)))}`;

    appendOutput(t`${bold(fg(COLORS.green)("▶"))} ${bold(`Running ${label}`)}`);
    appendOutput(divider);
    statusText.content = t`${fg(COLORS.yellow)(`⟳  Running ${label}…`)}`;
    updateCounts();

    const args = ["test", "--reporter=list"];
    if (file) args.push(join(ROOT, file));

    const proc = spawn(PLAYWRIGHT_BIN, args, { cwd: ROOT });
    currentProcess = proc;

    let stdoutBuf = "";
    let stderrBuf = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      lines.forEach((l) => processLine(l));
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop() ?? "";
      lines.forEach((l) => processLine(l, true));
    });

    proc.on("close", (code: number | null) => {
      // Flush any remaining buffered output
      if (stdoutBuf.trim()) processLine(stdoutBuf);
      if (stderrBuf.trim()) processLine(stderrBuf, true);

      appendOutput(divider);

      if (code === 0) {
        appendOutput(t`${bold(fg(COLORS.green)("✓ All tests passed"))}`);
        statusText.content = t`${fg(COLORS.green)(`✓ Done — ${label}`)}`;
      } else {
        appendOutput(
          t`${bold(fg(COLORS.red)(`✗ Finished with ${failCount} failure(s)`))}`
        );
        statusText.content = t`${fg(COLORS.red)(`✗ Failed — ${label}`)}`;
      }

      running = false;
      currentProcess = null;
    });
  }

  // ── Key bindings ──────────────────────────────────────────────────────────

  fileSelect.focus();

  renderer.keyInput.on("keypress", (key) => {
    // Quit
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      quit();
    }

    // Run all
    if (key.name === "a") {
      runTests(null);
      return;
    }

    // Stop running process
    if (key.name === "x") {
      if (currentProcess) {
        currentProcess.kill();
        statusText.content = t`${fg(COLORS.yellow)("⬛ Stopped by user")}`;
        running = false;
        currentProcess = null;
      }
      return;
    }

    // Run selected
    if (key.name === "r" || key.name === "return") {
      const opt = fileSelect.getSelectedOption();
      if (!opt) return;
      runTests(opt.value === "__all__" ? null : opt.value);
    }
  });

  // ── Initial welcome message ────────────────────────────────────────────────

  appendOutput(
    t`${dim(
      fg(COLORS.muted)(
        "Welcome! Select a test file on the left, then press r or Enter to run it."
      )
    )}`
  );

  if (testFiles.length === 0) {
    appendOutput(
      t`${fg(COLORS.yellow)(
        `No test files found in ${ROOT}`
      )}`
    );
  } else {
    appendOutput(
      t`${dim(fg(COLORS.muted)(`Project: ${ROOT}`))}`
    );
    appendOutput(
      t`${dim(fg(COLORS.muted)(`Found ${testFiles.length} test file(s)`))} `
    );
  }

  renderer.start();
}

main().catch(console.error);
