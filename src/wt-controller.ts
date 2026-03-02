import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { TerminalBackend, ClaudeResult, RunOpts } from './types.js';
import { loadConfig } from './config.js';

const PANE_LABELS: Record<number, string> = { 0: 'Builder', 1: 'Tester' };
const PROGRESS_INTERVAL_MS = 30_000;

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m${rem.toString().padStart(2, '0')}s`;
}

export class WtController implements TerminalBackend {
  name = 'wt' as const;
  private logFiles: Record<number, string> = {};

  async init(workDir: string): Promise<void> {
    fs.mkdirSync(workDir, { recursive: true });
    this.logFiles[0] = path.join(workDir, 'pane-builder.log');
    this.logFiles[1] = path.join(workDir, 'pane-tester.log');
    fs.writeFileSync(this.logFiles[0], '[ Builder ] Waiting for project...\r\n', 'utf-8');
    fs.writeFileSync(this.logFiles[1], '[ Tester ] Waiting for project...\r\n', 'utf-8');

    // Open Windows Terminal with two split panes tailing the log files
    try {
      const wtChild = spawn('wt.exe', [
        'new-tab', '--title', 'Builder',
        'powershell', '-NoExit', '-Command',
        `Get-Content -Path '${this.logFiles[0]}' -Wait -Tail 200 -Encoding UTF8`,
        ';',
        'split-pane', '-V', '--title', 'Tester',
        'powershell', '-NoExit', '-Command',
        `Get-Content -Path '${this.logFiles[1]}' -Wait -Tail 200 -Encoding UTF8`,
      ], { detached: true, stdio: 'ignore' });
      wtChild.unref();
      console.log('[wt] Windows Terminal opened with Builder | Tester split panes');
    } catch (err: any) {
      console.log(`[wt] Could not open Windows Terminal: ${err.message}`);
      console.log('[wt] Open two PowerShell windows manually and run:');
      console.log(`  Get-Content '${this.logFiles[0]}' -Wait -Encoding UTF8`);
      console.log(`  Get-Content '${this.logFiles[1]}' -Wait -Encoding UTF8`);
    }
  }

  async runClaude(pane: 0 | 1, prompt: string, workDir: string, opts?: RunOpts): Promise<ClaudeResult> {
    const config = loadConfig();
    const timeoutMs = opts?.timeoutMs ?? 10 * 60 * 1000;
    const maxTurns = opts?.maxTurns ?? config.maxTurnsBuilder;
    const claudePath = config.claudePath;
    const label = PANE_LABELS[pane] ?? `Pane ${pane}`;
    const logFile = this.logFiles[pane];
    const startTime = Date.now();

    // Reset log for this run (ASCII only to avoid encoding issues)
    const header = `${'='.repeat(50)}\r\n[${label}] Starting (max-turns=${maxTurns})\r\n${'='.repeat(50)}\r\n\r\n`;
    fs.writeFileSync(logFile, header, 'utf-8');

    console.log(`[${label}] Starting in pane ${pane} (max-turns=${maxTurns})`);

    // Spawn claude directly with cwd — no bash wrapper needed
    const args = [
      '-p', prompt,
      '--verbose',
      '--dangerously-skip-permissions',
      '--max-turns', String(maxTurns),
    ];

    return new Promise((resolve) => {
      const child = spawn(claudePath, args, {
        cwd: workDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0' },
        shell: true,
      });

      child.stdin.end();

      let stdout = '';

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        try { fs.appendFileSync(logFile, text, 'utf-8'); } catch { /* ignore */ }
      });

      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        if (text.trim()) {
          try { fs.appendFileSync(logFile, text, 'utf-8'); } catch { /* ignore */ }
        }
      });

      const progressInterval = setInterval(() => {
        console.log(`[${label}] Working... ${formatElapsed(Date.now() - startTime)} elapsed`);
      }, PROGRESS_INTERVAL_MS);

      const timer = setTimeout(() => {
        console.warn(`[${label}] Timed out after ${formatElapsed(timeoutMs)}`);
        try { fs.appendFileSync(logFile, `\r\n[TIMED OUT]\r\n`, 'utf-8'); } catch { /* ignore */ }
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        clearInterval(progressInterval);
        const durationMs = Date.now() - startTime;
        try { fs.appendFileSync(logFile, `\r\n[${label}] Done (${formatElapsed(durationMs)})\r\n`, 'utf-8'); } catch { /* ignore */ }
        console.log(`[${label}] Done (${formatElapsed(durationMs)})`);
        resolve({ output: stdout, exitCode: code ?? 1, durationMs, pane });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        clearInterval(progressInterval);
        try { fs.appendFileSync(logFile, `\r\n[ERROR: ${err.message}]\r\n`, 'utf-8'); } catch { /* ignore */ }
        console.error(`[${label}] Error: ${err.message}`);
        resolve({ output: '', exitCode: 1, durationMs: Date.now() - startTime, pane });
      });
    });
  }

  async cleanup(): Promise<void> {
    console.log('[wt] Log files preserved for review');
  }
}
