export interface Project {
  id: string;
  name: string;
  description: string;
  source: 'default' | 'twitch' | 'local';
  requestedBy?: string;
  workDir?: string;
}

export interface ChatMessage {
  id: string;
  user: string;
  text: string;
  timestamp: number;
  processed: boolean;
}

export interface ClaudeResult {
  output: string;
  exitCode: number;
  durationMs: number;
  pane: 0 | 1;
}

export interface AgentState {
  phase: 'idle' | 'building' | 'testing' | 'iterating' | 'completing';
  currentProject: Project | null;
  iteration: number;
}

export interface RunOpts {
  timeoutMs?: number;
  maxTurns?: number;
  maxBudgetUsd?: number;
}

export interface TerminalBackend {
  name: 'tmux' | 'spawn' | 'wt';
  init(workDir: string): Promise<void>;
  runClaude(pane: 0 | 1, prompt: string, workDir: string, opts?: RunOpts): Promise<ClaudeResult>;
  cleanup(): Promise<void>;
}
