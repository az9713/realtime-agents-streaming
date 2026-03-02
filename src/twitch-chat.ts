import { EventEmitter } from 'events';
import tmi from 'tmi.js';
import type { TwitchConfig } from './config.js';

export class TwitchChat extends EventEmitter {
  private client: tmi.Client;
  private config: TwitchConfig;

  constructor(config: TwitchConfig) {
    super();
    this.config = config;

    this.client = new tmi.Client({
      options: { debug: false },
      connection: {
        secure: true,
        reconnect: true,
      },
      identity: {
        username: config.botUsername,
        password: config.oauth,
      },
      channels: [config.channel],
    });
  }

  async connect(): Promise<void> {
    this.client.on('message', (_channel, tags, message, self) => {
      if (self) return; // Ignore own messages
      const user = tags['display-name'] || tags.username || 'unknown';
      this.emit('message', user, message);
    });

    this.client.on('connected', (addr, port) => {
      console.log(`[Twitch] Connected to ${addr}:${port}`);
    });

    this.client.on('disconnected', (reason) => {
      console.log(`[Twitch] Disconnected: ${reason}`);
    });

    await this.client.connect();
  }

  async say(message: string): Promise<void> {
    // Twitch has a 500 char limit
    const truncated = message.length > 490 ? message.slice(0, 487) + '...' : message;
    await this.client.say(this.config.channel, truncated);
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }
}
