import fs from 'fs';
import path from 'path';
import type { Project } from './types.js';

export function createWorkspace(project: Project, baseDir: string): string {
  // Create base dir if missing
  fs.mkdirSync(baseDir, { recursive: true });

  // Build workspace name: project-name-timestamp
  const safeName = project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const timestamp = Date.now();
  const dirName = `${safeName}-${timestamp}`;
  const workDir = path.join(baseDir, dirName);

  fs.mkdirSync(workDir, { recursive: true });

  // Write initial NOTES.md
  const notes = `# ${project.name}

## Project Description
${project.description}

## Source
${project.source}${project.requestedBy ? ` (requested by ${project.requestedBy})` : ''}

## Coordination Protocol
- **Pane 0 (Builder)**: Write code files here. When done, append "BUILD COMPLETE" to this file.
- **Pane 1 (Tester)**: Watch for "BUILD COMPLETE" in this file, then review code and report bugs below.
- Bugs should be listed under "## Bugs Found" section.
- If no bugs: write "NO CHANGES NEEDED" under "## Bugs Found".
`;

  fs.writeFileSync(path.join(workDir, 'NOTES.md'), notes, 'utf-8');

  // Set workDir on project
  project.workDir = workDir;

  console.log(`[Workspace] Created: ${workDir}`);
  return workDir;
}

export function cleanupOldWorkspaces(baseDir: string, keep: number = 3): void {
  if (!fs.existsSync(baseDir)) return;

  const entries = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({
      name: e.name,
      path: path.join(baseDir, e.name),
      mtime: fs.statSync(path.join(baseDir, e.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime); // newest first

  if (entries.length <= keep) return;

  const toRemove = entries.slice(keep);
  for (const entry of toRemove) {
    fs.rmSync(entry.path, { recursive: true, force: true });
    console.log(`[Workspace] Cleaned up old workspace: ${entry.name}`);
  }
}
