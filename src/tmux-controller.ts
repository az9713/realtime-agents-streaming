import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { TerminalBackend, ClaudeResult, RunOpts } from './types.js';
import { loadConfig } from './config.js';

const SESSION = 'agent';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const POLL_INTERVAL_MS = 3000;
const PROGRESS_INTERVAL_MS = 30_000;

const PANE_LABELS: Record<number, string> = { 0: 'Builder', 1: 'Tester' };

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m${rem.toString().padStart(2, '0')}s`;
}

function bashEscape(str: string): string {
  return str.replace(/'/g, "'\\''");
}

/** Convert Windows path to MINGW: C:\Users\... → /c/Users/... */
function toMingw(p: string): string {
  return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d: string) => `/${d.toLowerCase()}`);
}

export class TmuxController implements TerminalBackend {
  name = 'tmux' as const;
  private paneCwd = '';

  async init(workDir: string): Promise<void> {
    try {
      this.tmux(`kill-session -t ${SESSION}`);
    } catch { /* no existing session */ }

    this.paneCwd = workDir;
    const bashWorkDir = toMingw(workDir);
    this.tmux(`new-session -d -s ${SESSION} -x 220 -y 50 -c '${bashWorkDir}'`);
    this.tmux(`split-window -h -t ${SESSION} -c '${bashWorkDir}'`);
    this.tmux(`select-pane -t ${SESSION}:0.0`);

    console.log(`[tmux] Session "${SESSION}" created with 2 panes`);
    console.log(`[tmux] Attach from another terminal: tmux attach -t ${SESSION}`);
  }

  async runClaude(pane: 0 | 1, prompt: string, workDir: string, opts?: RunOpts): Promise<ClaudeResult> {
    const config = loadConfig();
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxTurns = opts?.maxTurns ?? config.maxTurnsBuilder;
    const claudePath = config.claudePath;
    const label = PANE_LABELS[pane] ?? `Pane ${pane}`;

    const sentinel = `__DONE_${crypto.randomBytes(4).toString('hex')}__`;
    const startTime = Date.now();

    const bashWorkDir = toMingw(workDir);
    const escapedPrompt = bashEscape(prompt);

    const script = `#!/bin/bash
cd '${bashWorkDir}'
${claudePath} -p '${escapedPrompt}' --verbose --dangerously-skip-permissions --max-turns ${maxTurns} < /dev/null
echo ${sentinel}
`;

    // Write script to the pane's CWD (short filename avoids wrapping)
    const scriptName = `cmd-${crypto.randomBytes(4).toString('hex')}.sh`;
    const scriptWinPath = path.join(this.paneCwd, scriptName);
    fs.writeFileSync(scriptWinPath, script, 'utf-8');

    console.log(`[${label}] Starting in tmux pane ${pane} (max-turns=${maxTurns})`);

    // Send just the short filename
    this.sendKeys(pane, `bash ${scriptName}`);

    // Poll for sentinel with progress logging
    const result = await this.waitForSentinel(pane, sentinel, timeoutMs, label, startTime);
    const durationMs = Date.now() - startTime;

    // Cleanup script file
    try { fs.unlinkSync(scriptWinPath); } catch { /* ignore */ }

    console.log(`[${label}] Done (${formatElapsed(durationMs)})`);

    return {
      output: result,
      exitCode: 0,
      durationMs,
      pane,
    };
  }

  async cleanup(): Promise<void> {
    try {
      this.tmux(`kill-session -t ${SESSION}`);
      console.log(`[tmux] Session "${SESSION}" killed`);
    } catch { /* already dead */ }
  }

  /** Run a tmux command via bash (bypasses cmd.exe quote mangling) */
  private tmux(args: string): string {
    const result = spawnSync('bash', ['-c', `tmux ${args}`], {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    if (result.error) throw result.error;
    if (result.status !== 0 && result.stderr) {
      throw new Error(result.stderr);
    }
    return result.stdout;
  }

  private sendKeys(pane: 0 | 1, command: string): void {
    const escaped = command.replace(/"/g, '\\"');
    this.tmux(`send-keys -t ${SESSION}:0.${pane} "${escaped}" Enter`);
  }

  private capturePane(pane: 0 | 1): string {
    try {
      return this.tmux(`capture-pane -t ${SESSION}:0.${pane} -p -S -200`);
    } catch {
      return '';
    }
  }

  private async waitForSentinel(
    pane: 0 | 1,
    sentinel: string,
    timeoutMs: number,
    label: string,
    startTime: number,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let lastProgressLog = 0;

    return new Promise((resolve) => {
      const check = () => {
        const output = this.capturePane(pane);

        if (output.includes(sentinel)) {
          resolve(output);
          return;
        }

        // Progress logging every 30s
        const now = Date.now();
        if (now - lastProgressLog >= PROGRESS_INTERVAL_MS) {
          lastProgressLog = now;
          console.log(`[${label}] Working... ${formatElapsed(now - startTime)} elapsed`);
        }

        if (now > deadline) {
          console.warn(`[${label}] Timed out after ${formatElapsed(timeoutMs)}, sending Ctrl-C`);
          try {
            this.tmux(`send-keys -t ${SESSION}:0.${pane} C-c`);
          } catch { /* best effort */ }
          resolve(this.capturePane(pane));
          return;
        }

        setTimeout(check, POLL_INTERVAL_MS);
      };

      check();
    });
  }
}
