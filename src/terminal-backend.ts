import { spawnSync } from 'child_process';
import type { TerminalBackend } from './types.js';
import { TmuxController } from './tmux-controller.js';
import { SpawnController } from './spawn-controller.js';
import { WtController } from './wt-controller.js';

export function createBackend(override?: 'tmux' | 'spawn' | 'wt'): TerminalBackend {
  if (override === 'wt') {
    console.log('[Backend] Using Windows Terminal (wt) backend');
    return new WtController();
  }

  if (override === 'tmux') {
    if (!isTmuxAvailable()) {
      throw new Error('TERMINAL_BACKEND=tmux but tmux is not installed. Install via: pacman -S tmux');
    }
    return new TmuxController();
  }

  if (override === 'spawn') {
    return new SpawnController();
  }

  // Auto-detect
  if (isTmuxAvailable()) {
    console.log('[Backend] tmux detected — using tmux backend');
    return new TmuxController();
  }

  console.log('[Backend] tmux not found — using spawn backend');
  return new SpawnController();
}

function isTmuxAvailable(): boolean {
  try {
    const result = spawnSync('bash', ['-c', 'tmux -V'], { stdio: 'pipe' });
    return result.status === 0;
  } catch {
    return false;
  }
}
