import { spawn, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import type { TerminalBackend, ClaudeResult, RunOpts } from './types.js';
import { loadConfig } from './config.js';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const PROGRESS_INTERVAL_MS = 30_000; // 30 seconds

const PANE_LABELS: Record<number, string> = { 0: 'Builder', 1: 'Tester' };

/**
 * Escape a string for embedding inside bash single quotes.
 *   e.g. "it's" → 'it'\''s'
 */
function bashEscape(str: string): string {
  return str.replace(/'/g, "'\\''");
}

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m${rem.toString().padStart(2, '0')}s`;
}

export class SpawnController implements TerminalBackend {
  name = 'spawn' as const;
  private children: Map<number, ChildProcess> = new Map();

  async init(_workDir: string): Promise<void> {
    console.log('[spawn] Backend ready (no tmux required)');
  }

  async runClaude(pane: 0 | 1, prompt: string, workDir: string, opts?: RunOpts): Promise<ClaudeResult> {
    const config = loadConfig();
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxTurns = opts?.maxTurns ?? config.maxTurnsBuilder;
    const claudePath = config.claudePath;
    const label = PANE_LABELS[pane] ?? `Pane ${pane}`;

    const startTime = Date.now();

    const bashWorkDir = workDir.replace(/\\/g, '/');
    const escapedPrompt = bashEscape(prompt);
    const cmd = `cd '${bashWorkDir}' && ${claudePath} -p '${escapedPrompt}' --dangerously-skip-permissions --max-turns ${maxTurns}`;

    console.log(`[${label}] Starting (max-turns=${maxTurns}, timeout=${Math.round(timeoutMs / 1000)}s)`);

    return new Promise<ClaudeResult>((resolve, reject) => {
      const child = spawn('bash', ['-c', cmd], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      child.stdin.end();

      this.children.set(pane, child);

      let stdout = '';
      let stderr = '';
      let lastActivity = Date.now();

      // Progress timer — shows elapsed time every 30s so user knows it's alive
      const progressTimer = setInterval(() => {
        const elapsed = formatElapsed(Date.now() - startTime);
        const idle = formatElapsed(Date.now() - lastActivity);
        console.log(`[${label}] Working... ${elapsed} elapsed (last output ${idle} ago)`);
      }, PROGRESS_INTERVAL_MS);

      child.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        lastActivity = Date.now();
        for (const line of chunk.split('\n')) {
          if (line.trim()) {
            console.log(`[${label}] ${line}`);
          }
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        lastActivity = Date.now();
      });

      const timer = setTimeout(() => {
        console.warn(`[${label}] Timed out after ${formatElapsed(timeoutMs)}, killing process`);
        child.kill('SIGKILL');
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        clearInterval(progressTimer);
        this.children.delete(pane);
        const durationMs = Date.now() - startTime;
        console.log(`[${label}] Done (exit ${code}, ${formatElapsed(durationMs)})`);

        resolve({
          output: stdout || stderr,
          exitCode: code ?? 1,
          durationMs,
          pane,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        clearInterval(progressTimer);
        this.children.delete(pane);
        reject(new Error(`Failed to spawn claude on pane ${pane}: ${err.message}`));
      });
    });
  }

  async cleanup(): Promise<void> {
    for (const [pane, child] of this.children) {
      console.log(`[spawn] Killing process on pane ${pane}`);
      child.kill('SIGKILL');
    }
    this.children.clear();
  }
}
