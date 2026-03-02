import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Project } from './types.js';
import { pickRandomDefault } from './default-projects.js';

const MAX_QUEUE_SIZE = 20;

export class ProjectQueue {
  private queueFile: string;
  private historyFile: string;

  constructor(queueFile: string) {
    this.queueFile = queueFile;
    this.historyFile = path.join(path.dirname(queueFile), 'history.json');

    // Ensure data directory exists
    fs.mkdirSync(path.dirname(queueFile), { recursive: true });
  }

  enqueue(project: Project): boolean {
    const queue = this.load();

    // Dedup by normalized name
    const normalized = project.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const isDuplicate = queue.some(
      p => p.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized
    );

    if (isDuplicate) {
      console.log(`[Queue] Duplicate project skipped: ${project.name}`);
      return false;
    }

    if (queue.length >= MAX_QUEUE_SIZE) {
      console.log(`[Queue] Queue full (${MAX_QUEUE_SIZE}), dropping: ${project.name}`);
      return false;
    }

    queue.push(project);
    this.save(queue);
    console.log(`[Queue] Enqueued: ${project.name} (${queue.length} in queue)`);
    return true;
  }

  dequeue(): Project | null {
    const queue = this.load();
    if (queue.length === 0) return null;

    const project = queue.shift()!;
    this.save(queue);
    return project;
  }

  getNextOrDefault(): Project {
    const queued = this.dequeue();
    if (queued) {
      console.log(`[Queue] Next project from queue: ${queued.name}`);
      return queued;
    }

    const defaultProject = pickRandomDefault();
    console.log(`[Queue] Queue empty — random default: ${defaultProject.name}`);
    return defaultProject;
  }

  markComplete(project: Project): void {
    const history = this.loadHistory();
    history.push({
      ...project,
      completedAt: new Date().toISOString(),
    });
    this.saveHistory(history);
    console.log(`[Queue] Completed: ${project.name}`);
  }

  size(): number {
    return this.load().length;
  }

  private load(): Project[] {
    try {
      if (!fs.existsSync(this.queueFile)) return [];
      const data = fs.readFileSync(this.queueFile, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      console.warn(`[Queue] Failed to parse queue file, resetting: ${err}`);
      return [];
    }
  }

  private save(queue: Project[]): void {
    const tmpFile = this.queueFile + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(queue, null, 2), 'utf-8');
    fs.renameSync(tmpFile, this.queueFile);
  }

  private loadHistory(): Array<Project & { completedAt: string }> {
    try {
      if (!fs.existsSync(this.historyFile)) return [];
      const data = fs.readFileSync(this.historyFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  private saveHistory(history: Array<Project & { completedAt: string }>): void {
    const tmpFile = this.historyFile + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(history, null, 2), 'utf-8');
    fs.renameSync(tmpFile, this.historyFile);
  }
}
