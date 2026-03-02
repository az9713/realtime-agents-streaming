import { spawn } from 'child_process';
import type { TerminalBackend, ClaudeResult, RunOpts } from './types.js';
import { loadConfig } from './config.js';

function bashEscape(str: string): string {
  return str.replace(/'/g, "'\\''");
}

/**
 * High-level function that delegates to the active backend.
 */
export async function runClaudeInTerminal(opts: {
  backend: TerminalBackend;
  pane: 0 | 1;
  prompt: string;
  workDir: string;
  timeoutMs?: number;
  maxTurns?: number;
  maxBudgetUsd?: number;
}): Promise<ClaudeResult> {
  const runOpts: RunOpts = {
    timeoutMs: opts.timeoutMs ?? 5 * 60 * 1000,
    maxTurns: opts.maxTurns,
    maxBudgetUsd: opts.maxBudgetUsd,
  };

  return opts.backend.runClaude(opts.pane, opts.prompt, opts.workDir, runOpts);
}

/**
 * Standalone one-shot runner for short tasks like chat analysis.
 * Always uses direct spawn via bash — fast and lightweight.
 */
export async function runClaudeOneShot(opts: {
  prompt: string;
  workDir: string;
  timeoutMs?: number;
}): Promise<ClaudeResult> {
  const config = loadConfig();
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const startTime = Date.now();

  const bashWorkDir = opts.workDir.replace(/\\/g, '/');
  const escapedPrompt = bashEscape(opts.prompt);
  const cmd = `cd '${bashWorkDir}' && ${config.claudePath} -p '${escapedPrompt}' --dangerously-skip-permissions --max-turns 1`;

  return new Promise<ClaudeResult>((resolve, reject) => {
    const child = spawn('bash', ['-c', cmd], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    child.stdin.end();

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        output: stdout || stderr,
        exitCode: code ?? 1,
        durationMs: Date.now() - startTime,
        pane: 0,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`One-shot Claude failed: ${err.message}`));
    });
  });
}
