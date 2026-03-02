import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { TerminalBackend, Project, ChatMessage, AgentState } from './types.js';
import type { Config } from './config.js';
import { ProjectQueue } from './project-queue.js';
import { createWorkspace } from './workspace.js';
import { runClaudeInTerminal, runClaudeOneShot } from './claude-runner.js';
import { buildProject, testProject, iterateProject, retestProject, detectProjectRequest } from './prompts.js';

export class AgentController {
  private backend: TerminalBackend;
  private queue: ProjectQueue;
  private config: Config;
  private state: AgentState;
  private running = false;
  private chatBuffer: ChatMessage[] = [];
  private chatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(backend: TerminalBackend, queue: ProjectQueue, config: Config) {
    this.backend = backend;
    this.queue = queue;
    this.config = config;
    this.state = {
      phase: 'idle',
      currentProject: null,
      iteration: 0,
    };
  }

  async start(): Promise<void> {
    this.running = true;

    // Start chat batch processing timer
    this.chatTimer = setInterval(() => {
      this.processChatBatch().catch(err => {
        console.error('[Agent] Chat batch processing error:', err.message);
      });
    }, 10_000);

    console.log('[Agent] Controller started — entering main loop');

    while (this.running) {
      try {
        const project = this.queue.getNextOrDefault();
        await this.runProjectCycle(project);

        // Brief pause between projects
        if (this.running) {
          console.log(`[Agent] Idle for ${this.config.idleTimeoutMs}ms before next project...`);
          await sleep(this.config.idleTimeoutMs);
        }
      } catch (err: any) {
        console.error('[Agent] Project cycle error:', err.message);
        // Continue to next project after error
        await sleep(3000);
      }
    }
  }

  stop(): void {
    this.running = false;
    if (this.chatTimer) {
      clearInterval(this.chatTimer);
      this.chatTimer = null;
    }
    console.log('[Agent] Controller stopped');
  }

  bufferChatMessage(user: string, text: string): void {
    this.chatBuffer.push({
      id: crypto.randomUUID(),
      user,
      text,
      timestamp: Date.now(),
      processed: false,
    });
  }

  private async runProjectCycle(project: Project): Promise<void> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Agent] Starting project: ${project.name}`);
    console.log(`[Agent] Source: ${project.source}${project.requestedBy ? ` (by ${project.requestedBy})` : ''}`);
    console.log(`${'='.repeat(60)}\n`);

    this.state.currentProject = project;
    this.state.iteration = 0;

    // 1. Create workspace
    const workDir = createWorkspace(project, this.config.projectsBaseDir);

    // ── Step 1: Builder creates the project (pane 0) ──
    this.state.phase = 'building';
    console.log('[Agent] >>> BUILDER (pane 0): Creating project...');

    const buildPrompt = buildProject(project.description, workDir, project.name);
    const buildResult = await runClaudeInTerminal({
      backend: this.backend,
      pane: 0,
      prompt: buildPrompt,
      workDir,
      maxTurns: this.config.maxTurnsBuilder,
      timeoutMs: 10 * 60 * 1000,
    });
    console.log(`[Agent] Builder done (${(buildResult.durationMs / 1000).toFixed(1)}s)`);

    // ── Step 2: Tester reviews the built project (pane 1) ──
    this.state.phase = 'testing';
    console.log('[Agent] >>> TESTER (pane 1): Reviewing project...');

    const testPrompt = testProject(project.description, workDir, project.name);
    const testResult = await runClaudeInTerminal({
      backend: this.backend,
      pane: 1,
      prompt: testPrompt,
      workDir,
      maxTurns: this.config.maxTurnsTester,
      timeoutMs: 10 * 60 * 1000,
    });
    console.log(`[Agent] Tester done (${(testResult.durationMs / 1000).toFixed(1)}s)`);

    // ── Step 3: Fix → Retest loop ──
    for (let i = 1; i <= this.config.maxIterations; i++) {
      this.state.phase = 'iterating';
      this.state.iteration = i;

      // Read NOTES.md for bugs
      const notesPath = path.join(workDir, 'NOTES.md');
      let notes = '';
      try {
        notes = fs.readFileSync(notesPath, 'utf-8');
      } catch {
        console.log('[Agent] Could not read NOTES.md — done iterating');
        break;
      }

      // Check if tester is satisfied
      if (notes.includes('NO CHANGES NEEDED') || notes.includes('ALL FIXES VERIFIED')) {
        console.log('[Agent] Tester is satisfied — no bugs remaining!');
        break;
      }

      if (!notes.includes('## Bugs Found')) {
        console.log('[Agent] No "## Bugs Found" section — done iterating');
        break;
      }

      // ── Builder fixes bugs (pane 0) ──
      console.log(`[Agent] >>> BUILDER (pane 0): Fixing bugs (iteration ${i}/${this.config.maxIterations})...`);
      const fixPrompt = iterateProject(workDir, project.name, i);
      const fixResult = await runClaudeInTerminal({
        backend: this.backend,
        pane: 0,
        prompt: fixPrompt,
        workDir,
        maxTurns: this.config.maxTurnsBuilder,
        timeoutMs: 10 * 60 * 1000,
      });
      console.log(`[Agent] Builder fix done (${(fixResult.durationMs / 1000).toFixed(1)}s)`);

      // ── Tester verifies fixes (pane 1) ──
      console.log(`[Agent] >>> TESTER (pane 1): Verifying fixes (iteration ${i}/${this.config.maxIterations})...`);
      const retPrompt = retestProject(workDir, project.name, i);
      const retResult = await runClaudeInTerminal({
        backend: this.backend,
        pane: 1,
        prompt: retPrompt,
        workDir,
        maxTurns: this.config.maxTurnsTester,
        timeoutMs: 10 * 60 * 1000,
      });
      console.log(`[Agent] Tester retest done (${(retResult.durationMs / 1000).toFixed(1)}s)`);
    }

    // 4. Mark complete
    this.state.phase = 'completing';
    this.queue.markComplete(project);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Agent] Project "${project.name}" COMPLETE`);
    console.log(`[Agent] Files at: ${workDir}`);
    console.log(`${'='.repeat(60)}\n`);

    this.state.phase = 'idle';
    this.state.currentProject = null;
    this.state.iteration = 0;
  }

  private async processChatBatch(): Promise<void> {
    const unprocessed = this.chatBuffer.filter(m => !m.processed);
    if (unprocessed.length === 0) return;

    // Mark as processed
    unprocessed.forEach(m => { m.processed = true; });

    // Format chat text
    const chatText = unprocessed
      .map(m => `> ${m.user}: ${m.text}`)
      .join('\n');

    console.log(`[Agent] Processing ${unprocessed.length} chat messages for project requests...`);

    try {
      const prompt = detectProjectRequest(chatText);
      const result = await runClaudeOneShot({
        prompt,
        workDir: this.config.projectsBaseDir,
        timeoutMs: 15_000,
      });

      const output = result.output.trim();

      if (output === 'NONE' || !output.startsWith('PROJECT:')) {
        return;
      }

      // Parse: PROJECT: name | USER: user | DESC: description
      const match = output.match(/^PROJECT:\s*(.+?)\s*\|\s*USER:\s*(.+?)\s*\|\s*DESC:\s*(.+)$/);
      if (!match) {
        console.log(`[Agent] Could not parse project request: ${output}`);
        return;
      }

      const [, name, user, desc] = match;
      const project: Project = {
        id: crypto.randomUUID(),
        name: name.trim(),
        description: desc.trim(),
        source: 'twitch',
        requestedBy: user.trim(),
      };

      this.queue.enqueue(project);
      console.log(`[Agent] Viewer project queued: "${project.name}" by ${project.requestedBy}`);
    } catch (err: any) {
      console.error('[Agent] Chat analysis error:', err.message);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
