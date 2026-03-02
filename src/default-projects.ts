import crypto from 'crypto';
import type { Project } from './types.js';

interface DefaultProject {
  name: string;
  prompt: string;
}

const DEFAULTS: DefaultProject[] = [
  {
    name: 'color-clock',
    prompt: `Build an index.html: a fullscreen digital clock where the background color changes based on the time (hours=red, minutes=green, seconds=blue as hex). Show the time in large white text centered on screen. No libraries.`,
  },
  {
    name: 'click-counter',
    prompt: `Build an index.html: a big centered number starting at 0. Clicking anywhere increments it. The number should scale up briefly on each click (CSS animation). Dark background, bright number. No libraries.`,
  },
  {
    name: 'bouncing-ball',
    prompt: `Build an index.html: one ball bouncing around the screen using canvas. Ball changes color each time it hits a wall. Trail effect behind the ball. Dark background. No libraries.`,
  },
  {
    name: 'typing-test',
    prompt: `Build an index.html: show a random word from a list of 20 words. User types it. Show if correct (green) or wrong (red). Track score out of 10 rounds. Show final score. No libraries.`,
  },
  {
    name: 'gradient-waves',
    prompt: `Build an index.html: animated sine waves drawn on canvas. 3 overlapping waves with different colors and speeds. Dark background. No libraries.`,
  },
  {
    name: 'memory-game',
    prompt: `Build an index.html: a 4x4 memory card matching game. Cards are colored squares. Click to flip, match pairs. Track moves count. Show "You win!" when all matched. No libraries.`,
  },
];

export function pickRandomDefault(): Project {
  const idx = Math.floor(Math.random() * DEFAULTS.length);
  const d = DEFAULTS[idx];
  return {
    id: crypto.randomUUID(),
    name: d.name,
    description: d.prompt,
    source: 'default',
  };
}

export function getAllDefaults(): DefaultProject[] {
  return [...DEFAULTS];
}
