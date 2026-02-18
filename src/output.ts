import { t, fg, bold } from "@opentui/core";
import { COLORS } from "./config";
import { stripAnsi } from "./files";

export const colorizeLine = (raw: string): unknown => {
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
