import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  t,
  fg,
  bold,
  dim,
} from "@opentui/core";
import { spawn, type ChildProcess } from "child_process";
import { join, basename } from "path";
import { PROJECTS, COLORS } from "./config";
import { stripAnsi, getTestFiles } from "./files";
import { colorizeLine } from "./output";

// ── Per-project state ────────────────────────────────────────────────────────

interface FileItem {
  box: BoxRenderable;
  text: TextRenderable;
  value: string; // "__all__" or relative file path
}

interface ProjectState {
  root: string;
  playwrightBin: string;
  label: string;
  testFiles: string[];
  running: boolean;
  passCount: number;
  failCount: number;
  currentProcess: ChildProcess | null;
  reportProcess: ChildProcess | null;
  selectedIdx: number;
  fileStatus: Map<string, "passed" | "failed">;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outputLines: any[];
  fileItems: FileItem[];
}

// ── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false, // handled manually so we can kill subprocesses
    targetFps: 30,
  });

  const projects: ProjectState[] = PROJECTS.map(p => ({
    ...p,
    testFiles: getTestFiles(p.root),
    running: false,
    passCount: 0,
    failCount: 0,
    currentProcess: null,
    reportProcess: null,
    selectedIdx: 0,
    fileStatus: new Map(),
    outputLines: [],
    fileItems: [],
  }));

  let activeProject = projects[0];

  const quit = (code = 0) => {
    for (const p of projects) {
      p.currentProcess?.kill();
      p.reportProcess?.kill();
    }
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

  // ── Layout tree ──────────────────────────────────────────────────────────
  //
  //  renderer.root
  //  └── rootBox   [column]
  //      ├── headerBox   [row, height 3]
  //      │   ├── "Playwright TUI" title
  //      │   └── tab boxes × N
  //      ├── mainBox     [row, flexGrow 1]
  //      │   ├── leftPanel  [column, width 40]
  //      │   │   ├── fileSelect  [flexGrow 1]
  //      │   │   └── hintBox     [height N]
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

  // Build tab renderables (one per project)
  const tabTexts: TextRenderable[] = projects.map((p, i) => {
    const label = projects.length > 1 ? ` ${i + 1}: ${p.label} ` : ` ${p.label} `;
    const text = new TextRenderable(renderer, {
      id: `tab-${i}`,
      content: t`${bold(fg("#ffffff")(label))}`,
    });
    const tabBox = new BoxRenderable(renderer, {
      id: `tab-box-${i}`,
      backgroundColor: COLORS.selectedBg,
      paddingLeft: 1,
      paddingRight: 1,
    });
    tabBox.add(text);
    headerBox.add(tabBox);
    return text;
  });

  const tabBoxes: BoxRenderable[] = projects.map((_, i) =>
    headerBox.getChildren().find(c => c.id === `tab-box-${i}`) as BoxRenderable
  );

  const refreshTabBar = () => {
    projects.forEach((p, i) => {
      const isActive = p === activeProject;
      const label = projects.length > 1 ? ` ${i + 1}: ${p.label} ` : ` ${p.label} `;
      tabBoxes[i].backgroundColor = isActive ? COLORS.selectedBg : COLORS.bg;
      tabTexts[i].content = isActive
        ? t`${bold(fg("#ffffff")(label))}`
        : t`${dim(fg(COLORS.muted)(label))}`;
    });
  }

  refreshTabBar();

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

  const fileListScroll = new ScrollBoxRenderable(renderer, {
    id: "file-list",
    flexGrow: 1,
    contentOptions: { backgroundColor: COLORS.bg },
  });
  leftPanel.add(fileListScroll);

  const itemContent = (state: ProjectState, value: string, isSelected: boolean) => {
    const label = value === "__all__" ? "▶  Run All Tests" : `   ${basename(value)}`;
    if (isSelected) return t`${fg("#ffffff")(label)}`;
    const status = value !== "__all__" ? state.fileStatus.get(value) : undefined;
    if (status === "failed") return t`${fg(COLORS.red)(label)}`;
    return t`${fg(COLORS.text)(label)}`;
  }

  const buildFileItems = (state: ProjectState) => {
    const values = ["__all__", ...state.testFiles];
    values.forEach((value, i) => {
      const isSelected = i === state.selectedIdx;
      const box = new BoxRenderable(renderer, {
        id: `fi-${i}`,
        width: "100%",
        height: 1,
        backgroundColor: isSelected ? COLORS.selectedBg : COLORS.bg,
        paddingLeft: 1,
      });
      const text = new TextRenderable(renderer, {
        id: `fi-${i}-t`,
        content: itemContent(state, value, isSelected),
      });
      box.add(text);
      fileListScroll.add(box);
      state.fileItems.push({ box, text, value });
    });
  }

  const clearFileList = (state: ProjectState) => {
    const children = [...fileListScroll.getChildren()];
    for (const child of children) {
      fileListScroll.remove(child.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (child as any).destroyRecursively?.() ?? (child as any).destroy?.();
    }
    state.fileItems.length = 0;
  }

  const refreshFileItems = (state: ProjectState) => {
    state.fileItems.forEach((item, i) => {
      const isSelected = i === state.selectedIdx;
      item.box.backgroundColor = isSelected ? COLORS.selectedBg : COLORS.bg;
      item.text.content = itemContent(state, item.value, isSelected);
    });
    fileListScroll.scrollTo(Math.max(0, state.selectedIdx - 2));
  }

  const moveSelection = (delta: number) => {
    const total = activeProject.fileItems.length;
    activeProject.selectedIdx = ((activeProject.selectedIdx + delta) % total + total) % total;
    refreshFileItems(activeProject);
  }

  const getSelectedValue = (): string | null => {
    const item = activeProject.fileItems[activeProject.selectedIdx];
    if (!item || item.value === "__all__") return null;
    return item.value;
  }

  buildFileItems(activeProject);

  // Keyboard hints at the bottom of the left panel
  const hintEntries: [string, string][] = [
    ["r / ↵", "run selected file"],
    ["a    ", "run all tests"],
    ["R    ", "refresh file list"],
    ["u    ", "update snapshots"],
    ["g    ", "open in GUI mode"],
    ["v    ", "view HTML report"],
    ["x    ", "stop running"],
    ["q    ", "quit"],
  ];

  if (projects.length > 1) {
    hintEntries.push(["Tab  ", "switch tab"]);
    hintEntries.push(["1-9  ", "jump to tab"]);
  }

  const hintBox = new BoxRenderable(renderer, {
    id: "hints",
    width: "100%",
    height: hintEntries.length + 3,
    border: ["top"],
    borderStyle: "single",
    borderColor: COLORS.border,
    paddingLeft: 2,
    paddingTop: 1,
    flexDirection: "column",
  });
  leftPanel.add(hintBox);

  for (const [key, desc] of hintEntries) {
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
  const appendOutput = (state: ProjectState, content: any) => {
    state.outputLines.push(content);
    if (state === activeProject) {
      outputScroll.add(new TextRenderable(renderer, {
        id: `out-${state.outputLines.length - 1}`,
        content,
      }));
    }
  }

  const updateCounts = () => {
    passLabel.content = t`${bold(fg(COLORS.green)(`✓ ${activeProject.passCount} passed`))}`;
    failLabel.content = activeProject.failCount > 0
      ? t`${bold(fg(COLORS.red)(`✗ ${activeProject.failCount} failed`))}`
      : t``;
  }

  const clearOutput = (state: ProjectState) => {
    state.outputLines.length = 0;
    if (state === activeProject) {
      const children = [...outputScroll.getChildren()];
      for (const child of children) {
        outputScroll.remove(child.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (child as any).destroyRecursively?.() ?? (child as any).destroy?.();
      }
    }
  }

  const processLine = (state: ProjectState, raw: string, isStderr = false) => {
    const clean = stripAnsi(raw);
    if (!clean.trim()) return;

    // Extract pass/fail counts from the summary line
    const pm = clean.match(/(\d+) passed/);
    const fm = clean.match(/(\d+) failed/);
    if (pm) state.passCount = parseInt(pm[1]);
    if (fm) state.failCount = parseInt(fm[1]);
    if (state === activeProject) updateCounts();

    // Detect failing test file from list reporter lines like:
    //   ✗ [chromium] › tests/foo.spec.ts:10:1 › test name
    const failLine = clean.match(/[✗✘×]\s+.*?›\s+([^\s:]+\.(spec|test)\.[jt]s)/);
    if (failLine) {
      const failedFile = failLine[1];
      if (state.testFiles.includes(failedFile)) {
        state.fileStatus.set(failedFile, "failed");
      }
    }

    appendOutput(state, isStderr ? t`${fg(COLORS.red)(clean)}` : colorizeLine(raw));
  }

  // ── Test runner ───────────────────────────────────────────────────────────

  const runTests = (state: ProjectState, file: string | null, updateSnapshots = false) => {
    if (state.running) {
      appendOutput(state, t`${fg(COLORS.yellow)("Already running — press x to stop")}`);
      return;
    }

    state.running = true;
    state.passCount = 0;
    state.failCount = 0;
    clearOutput(state);

    const label = file ?? "all tests";
    const divider = t`${dim(fg(COLORS.border)("─".repeat(60)))}`;

    const actionLabel = updateSnapshots ? `Updating snapshots for ${label}` : `Running ${label}`;
    appendOutput(state, t`${bold(fg(COLORS.green)("▶"))} ${bold(actionLabel)}`);
    appendOutput(state, divider);
    if (state === activeProject) {
      statusText.content = t`${fg(COLORS.yellow)(`⟳  ${actionLabel}…`)}`;
      updateCounts();
    }

    const args = ["test", "--reporter=list,html"];
    if (updateSnapshots) args.push("--update-snapshots");
    if (file) args.push(join(state.root, file));

    const proc = spawn(state.playwrightBin, args, {
      cwd: state.root,
      env: { ...process.env, PLAYWRIGHT_HTML_OPEN: "never" },
    });
    state.currentProcess = proc;

    let stdoutBuf = "";
    let stderrBuf = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      lines.forEach((l) => processLine(state, l));
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop() ?? "";
      lines.forEach((l) => processLine(state, l, true));
    });

    proc.on("close", (code: number | null) => {
      // Flush any remaining buffered output
      if (stdoutBuf.trim()) processLine(state, stdoutBuf);
      if (stderrBuf.trim()) processLine(state, stderrBuf, true);

      appendOutput(state, divider);

      if (code === 0) {
        appendOutput(state, t`${bold(fg(COLORS.green)("✓ All tests passed"))}`);
        if (state === activeProject) {
          statusText.content = t`${fg(COLORS.green)(`✓ Done — ${label}`)}`;
        }
      } else {
        appendOutput(state, t`${bold(fg(COLORS.red)(`✗ Finished with ${state.failCount} failure(s)`))}`);
        if (state === activeProject) {
          statusText.content = t`${fg(COLORS.red)(`✗ Failed — ${label}`)}`;
        }
      }

      // For single-file runs, update its status if not already set by line parsing
      if (file) {
        if (code === 0) {
          state.fileStatus.set(file, "passed");
        } else if (!state.fileStatus.has(file)) {
          state.fileStatus.set(file, "failed");
        }
      }

      // Refresh the file list to reflect updated pass/fail status
      if (state === activeProject) {
        refreshFileItems(state);
      }

      state.running = false;
      state.currentProcess = null;
    });
  }

  // ── GUI mode launcher ─────────────────────────────────────────────────────

  const openGui = (state: ProjectState, file: string | null) => {
    const args = ["test", "--ui"];
    if (file) args.push(join(state.root, file));

    spawn(state.playwrightBin, args, {
      cwd: state.root,
      detached: true,
      stdio: "ignore",
    }).unref();
  }

  // ── HTML report viewer ────────────────────────────────────────────────────

  const openHtmlReport = (state: ProjectState) => {
    state.reportProcess?.kill();
    state.reportProcess = spawn(state.playwrightBin, ["show-report"], {
      cwd: state.root,
      stdio: "ignore",
    });
    state.reportProcess.on("close", () => { state.reportProcess = null; });
  }

  // ── Tab switching ─────────────────────────────────────────────────────────

  const switchToProject = (state: ProjectState) => {
    activeProject = state;

    // Rebuild file list for new active project
    clearFileList(activeProject);
    buildFileItems(activeProject);

    // Rebuild output scroll from buffer
    const children = [...outputScroll.getChildren()];
    for (const child of children) {
      outputScroll.remove(child.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (child as any).destroyRecursively?.() ?? (child as any).destroy?.();
    }
    state.outputLines.forEach((content, i) => {
      outputScroll.add(new TextRenderable(renderer, { id: `out-${i}`, content }));
    });

    updateCounts();
    refreshTabBar();
  }

  // ── Test file list refresh ────────────────────────────────────────────────

  const refreshTestFileList = () => {
    // Refresh all projects
    for (const p of projects) {
      p.testFiles = getTestFiles(p.root);
      p.selectedIdx = Math.min(p.selectedIdx, p.testFiles.length);
    }

    // Rebuild file list UI for active project
    clearFileList(activeProject);
    buildFileItems(activeProject);

    statusText.content = t`${fg(COLORS.green)(`↻ Refreshed — found ${activeProject.testFiles.length} test file(s)`)}`;
  }

  // ── Key bindings ──────────────────────────────────────────────────────────

  renderer.keyInput.on("keypress", (key) => {
    // Quit
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      quit();
    }

    // Navigate
    if (key.name === "up") { moveSelection(-1); return; }
    if (key.name === "down") { moveSelection(1); return; }

    // Tab switching (only when multiple projects)
    if (projects.length > 1) {
      if (key.name === "tab" && !key.shift) {
        const idx = projects.indexOf(activeProject);
        switchToProject(projects[(idx + 1) % projects.length]);
        return;
      }
      if (key.name === "tab" && key.shift) {
        const idx = projects.indexOf(activeProject);
        switchToProject(projects[(idx - 1 + projects.length) % projects.length]);
        return;
      }
      // Direct jump by number key 1-9
      const numMatch = key.name?.match(/^([1-9])$/);
      if (numMatch) {
        const targetIdx = parseInt(numMatch[1]) - 1;
        if (targetIdx < projects.length) {
          switchToProject(projects[targetIdx]);
          return;
        }
      }
    }

    // Run all
    if (key.name === "a") {
      runTests(activeProject, null);
      return;
    }

    // Refresh test file list (all projects)
    if (key.name === "R" || (key.shift && key.name === "r")) {
      refreshTestFileList();
      return;
    }

    // Stop running process
    if (key.name === "x") {
      if (activeProject.currentProcess) {
        activeProject.currentProcess.kill();
        statusText.content = t`${fg(COLORS.yellow)("⬛ Stopped by user")}`;
        activeProject.running = false;
        activeProject.currentProcess = null;
      }
      return;
    }

    // Run selected
    if (key.name === "r" || key.name === "return") {
      runTests(activeProject, getSelectedValue());
    }

    // Update snapshots for selected
    if (key.name === "u") {
      runTests(activeProject, getSelectedValue(), true);
    }

    // Open in GUI mode
    if (key.name === "g") {
      openGui(activeProject, getSelectedValue());
    }

    // View HTML report
    if (key.name === "v") {
      openHtmlReport(activeProject);
    }
  });

  // ── Initial welcome message ────────────────────────────────────────────────

  for (const state of projects) {
    appendOutput(
      state,
      t`${dim(fg(COLORS.muted)("Welcome! Select a test file on the left, then press r or Enter to run it."))}`
    );

    if (state.testFiles.length === 0) {
      appendOutput(
        state,
        t`${fg(COLORS.yellow)(`No test files found in ${state.root}`)}`
      );
    } else {
      appendOutput(state, t`${dim(fg(COLORS.muted)(`Project: ${state.root}`))}`);
      appendOutput(state, t`${dim(fg(COLORS.muted)(`Found ${state.testFiles.length} test file(s)`))} `);
    }
  }

  renderer.start();
}

main().catch(console.error);
