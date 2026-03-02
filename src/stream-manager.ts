import { spawn, execSync, type ChildProcess } from 'child_process';
import type { StreamConfig } from './config.js';
import { buildFfmpegArgs } from './ffmpeg-builder.js';

export class StreamManager {
  private config: StreamConfig;
  private process: ChildProcess | null = null;
  private isRunning = false;

  constructor(config: StreamConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    // Preflight checks
    this.preflight();

    if (!this.config.streamKey) {
      throw new Error('TWITCH_STREAM_KEY is required for streaming');
    }

    const args = buildFfmpegArgs(this.config);

    console.log('[Stream] Starting FFmpeg...');
    console.log(`[Stream] Command: ${this.config.ffmpegPath} ${args.join(' ').slice(0, 200)}...`);

    this.process = spawn(this.config.ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.isRunning = true;

    this.process.stderr?.on('data', (data: Buffer) => {
      const line = data.toString();
      // Only log important FFmpeg output
      if (line.includes('frame=') || line.includes('Error') || line.includes('Stream')) {
        process.stderr.write(`[Stream] ${line}`);
      }
    });

    this.process.on('close', (code) => {
      this.isRunning = false;
      if (code !== 0) {
        console.error(`[Stream] FFmpeg exited with code ${code}`);
      } else {
        console.log('[Stream] FFmpeg stopped');
      }
    });

    this.process.on('error', (err) => {
      this.isRunning = false;
      console.error(`[Stream] FFmpeg error: ${err.message}`);
    });

    console.log('[Stream] FFmpeg is live!');
  }

  async stop(): Promise<void> {
    if (!this.process || !this.isRunning) return;

    console.log('[Stream] Stopping FFmpeg...');

    // Try graceful SIGTERM first
    this.process.kill('SIGTERM');

    // Force kill after 5 seconds
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (this.isRunning && this.process) {
          console.log('[Stream] Force killing FFmpeg...');
          this.process.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      this.process!.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    this.isRunning = false;
  }

  private preflight(): void {
    // Check FFmpeg is available
    try {
      execSync(`${this.config.ffmpegPath} -version`, { stdio: 'pipe' });
    } catch {
      throw new Error(`FFmpeg not found at "${this.config.ffmpegPath}". Install FFmpeg or set FFMPEG_PATH in .env`);
    }

    // Check gdigrab is available (Windows-specific)
    try {
      const output = execSync(`${this.config.ffmpegPath} -devices 2>&1`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      if (!output.includes('gdigrab')) {
        console.warn('[Stream] WARNING: gdigrab device not found. Desktop capture may not work.');
      }
    } catch {
      console.warn('[Stream] WARNING: Could not check FFmpeg devices');
    }

    console.log('[Stream] Preflight checks passed');
  }
}
