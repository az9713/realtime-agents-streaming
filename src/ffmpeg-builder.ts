import { execSync } from 'child_process';
import type { StreamConfig } from './config.js';

/**
 * Build FFmpeg args for Windows desktop capture (gdigrab) with hacker visual effects.
 */
export function buildFfmpegArgs(config: StreamConfig): string[] {
  const rtmpUrl = `rtmp://live.twitch.tv/app/${config.streamKey}`;
  const hasRgbashift = checkFilterAvailable(config.ffmpegPath, 'rgbashift');

  // Hacker filter chain
  const filters: string[] = [
    'vignette=PI/6',
  ];

  if (hasRgbashift) {
    filters.push('rgbashift=rh=-2:bv=+2:rb=-1');
  }

  filters.push('eq=contrast=1.1:brightness=0.05');
  filters.push("geq=lum='if(mod(Y,4), lum(X,Y), lum(X,Y)*0.96)':cb='cb(X,Y)':cr='cr(X,Y)'");

  const hackerFilter = filters.join(',');

  const args: string[] = [
    // Input 0: Desktop capture (Windows gdigrab)
    '-f', 'gdigrab',
    '-framerate', '30',
    '-i', 'desktop',
  ];

  // Input 1: Overlay image (if exists)
  const hasOverlay = config.overlayImage && fileExists(config.overlayImage);
  if (hasOverlay) {
    args.push('-stream_loop', '-1', '-i', config.overlayImage);
  }

  // Input 2: Music playlist (if exists)
  const hasMusic = config.musicPlaylist && fileExists(config.musicPlaylist);
  if (hasMusic) {
    args.push('-f', 'concat', '-safe', '0', '-stream_loop', '-1', '-i', config.musicPlaylist!);
  }

  // Filter complex
  let filterComplex = `[0:v]${hackerFilter}[bg]`;

  if (hasOverlay) {
    filterComplex += `;[bg][1:v]overlay=0:0[outv]`;
  } else {
    filterComplex += `;[bg]copy[outv]`;
  }

  // Audio mixing (if we have music)
  if (hasMusic) {
    const musicIdx = hasOverlay ? 2 : 1;
    filterComplex += `;[${musicIdx}:a]volume=0.5[outa]`;
  }

  args.push('-filter_complex', filterComplex);

  args.push('-map', '[outv]');
  if (hasMusic) {
    args.push('-map', '[outa]');
  }

  // Encoding settings
  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', '3000k',
    '-maxrate', '3000k',
    '-bufsize', '6000k',
    '-pix_fmt', 'yuv420p',
    '-g', '60',
  );

  if (hasMusic) {
    args.push(
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
    );
  }

  args.push('-f', 'flv', rtmpUrl);

  return args;
}

function checkFilterAvailable(ffmpegPath: string, filterName: string): boolean {
  try {
    const output = execSync(`${ffmpegPath} -filters 2>&1`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return output.includes(filterName);
  } catch {
    return false;
  }
}

function fileExists(filepath: string): boolean {
  try {
    const fs = require('fs');
    return fs.existsSync(filepath);
  } catch {
    return false;
  }
}
