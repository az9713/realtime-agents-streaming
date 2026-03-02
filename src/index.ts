import readline from 'readline';
import crypto from 'crypto';
import { loadConfig } from './config.js';
import { createBackend } from './terminal-backend.js';
import { ProjectQueue } from './project-queue.js';
import { AgentController } from './agent-controller.js';
import type { Project } from './types.js';

async function main() {
  console.log('');
  console.log('=== AI Agent Streaming ===');
  console.log('');

  // Load config
  const config = loadConfig();

  // Auto-detect or override backend
  const backend = createBackend(config.terminalBackend);
  console.log(`[Main] Using backend: ${backend.name}`);

  // Initialize backend
  await backend.init(config.projectsBaseDir);

  // Create queue
  const queue = new ProjectQueue(config.queueFile);

  // Create controller
  const controller = new AgentController(backend, queue, config);

  // Wire up Twitch chat if configured
  if (config.twitch) {
    try {
      const { TwitchChat } = await import('./twitch-chat.js');
      const chat = new TwitchChat(config.twitch);

      chat.on('message', (user: string, text: string) => {
        controller.bufferChatMessage(user, text);
      });

      await chat.connect();
      console.log(`[Main] Twitch chat connected: ${config.twitch.channel}`);
    } catch (err: any) {
      console.error(`[Main] Twitch chat failed to connect: ${err.message}`);
    }
  }

  // Wire up streaming if enabled
  if (config.stream.enabled) {
    try {
      const { StreamManager } = await import('./stream-manager.js');
      const stream = new StreamManager(config.stream);
      await stream.start();
      console.log('[Main] Stream started');

      // Clean up stream on exit
      const origCleanup = async () => {
        await stream.stop();
      };
      process.on('SIGINT', origCleanup);
      process.on('SIGTERM', origCleanup);
    } catch (err: any) {
      console.error(`[Main] Stream failed to start: ${err.message}`);
    }
  }

  // Local chat input (stdin) — always available as fallback for project requests
  if (!config.twitch) {
    startLocalChat(controller, queue);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[Main] Shutting down...');
    controller.stop();
    await backend.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start the main loop
  await controller.start();
}

function startLocalChat(controller: AgentController, queue: ProjectQueue) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('[Main] Local mode — type a project description to queue it, or press Enter for random projects');
  console.log('[Main] Commands: "queue" to view queue, "quit" to exit\n');

  rl.on('line', (line) => {
    const input = line.trim();

    if (!input) return;

    if (input.toLowerCase() === 'quit' || input.toLowerCase() === 'exit') {
      process.emit('SIGINT', 'SIGINT');
      return;
    }

    if (input.toLowerCase() === 'queue') {
      console.log(`[Queue] ${queue.size()} projects in queue`);
      return;
    }

    // Treat input as a project request
    const project: Project = {
      id: crypto.randomUUID(),
      name: input.split(' ').slice(0, 3).join('-').toLowerCase(),
      description: input,
      source: 'local',
      requestedBy: 'local',
    };

    queue.enqueue(project);
  });
}

main().catch(err => {
  console.error('[Main] Fatal error:', err);
  process.exit(1);
});
