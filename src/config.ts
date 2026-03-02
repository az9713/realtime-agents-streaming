import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface TwitchConfig {
  channel: string;
  oauth: string;
  botUsername: string;
}

export interface StreamConfig {
  enabled: boolean;
  streamKey?: string;
  ffmpegPath: string;
  overlayImage: string;
  musicPlaylist?: string;
}

export interface Config {
  claudePath: string;
  maxTurnsBuilder: number;
  maxTurnsTester: number;
  maxBudgetUsd: number;
  idleTimeoutMs: number;
  maxIterations: number;
  projectsBaseDir: string;
  queueFile: string;
  terminalBackend?: 'tmux' | 'spawn' | 'wt';
  twitch: TwitchConfig | null;
  stream: StreamConfig;
}

function envStr(key: string, fallback?: string): string {
  const val = process.env[key];
  if (val !== undefined && val !== '') return val;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${key}`);
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined || val === '') return fallback;
  const n = parseInt(val, 10);
  if (isNaN(n)) throw new Error(`Invalid integer for ${key}: ${val}`);
  return n;
}

function loadTwitchConfig(): TwitchConfig | null {
  const channel = process.env.TWITCH_CHANNEL;
  if (!channel) return null;

  const oauth = process.env.TWITCH_OAUTH;
  const botUsername = process.env.TWITCH_BOT_USERNAME;

  if (!oauth || !botUsername) {
    console.warn('[Config] TWITCH_CHANNEL set but missing TWITCH_OAUTH or TWITCH_BOT_USERNAME — Twitch disabled');
    return null;
  }

  return { channel, oauth, botUsername };
}

function loadStreamConfig(): StreamConfig {
  const enabled = process.argv.includes('--stream');
  return {
    enabled,
    streamKey: process.env.TWITCH_STREAM_KEY,
    ffmpegPath: envStr('FFMPEG_PATH', 'ffmpeg'),
    overlayImage: envStr('OVERLAY_IMAGE', './assets/overlay.png'),
    musicPlaylist: process.env.MUSIC_PLAYLIST,
  };
}

export function loadConfig(): Config {
  const backend = process.env.TERMINAL_BACKEND as 'tmux' | 'spawn' | 'wt' | undefined;
  if (backend && backend !== 'tmux' && backend !== 'spawn' && backend !== 'wt') {
    throw new Error(`Invalid TERMINAL_BACKEND: ${backend}. Must be "tmux", "spawn", or "wt".`);
  }

  return {
    claudePath: envStr('CLAUDE_PATH', 'claude'),
    maxTurnsBuilder: envInt('MAX_TURNS_BUILDER', 20),
    maxTurnsTester: envInt('MAX_TURNS_TESTER', 8),
    maxBudgetUsd: envInt('MAX_BUDGET_USD', 5),
    idleTimeoutMs: envInt('IDLE_TIMEOUT_MS', 5000),
    maxIterations: envInt('MAX_ITERATIONS', 3),
    projectsBaseDir: path.resolve(envStr('PROJECTS_BASE_DIR', './projects')),
    queueFile: path.resolve(envStr('QUEUE_FILE', './data/queue.json')),
    terminalBackend: backend,
    twitch: loadTwitchConfig(),
    stream: loadStreamConfig(),
  };
}
