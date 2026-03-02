/**
 * Builder prompt — build it fast.
 */
export function buildProject(description: string, _workDir: string, name: string): string {
  return `Build "${name}". ${description} When done, append "BUILD COMPLETE" to NOTES.md.`;
}

/**
 * Tester prompt — read file, list 2-3 bugs, done.
 */
export function testProject(description: string, _workDir: string, name: string): string {
  return `Review "${name}". Read index.html. Find 2-3 bugs or missing features. Write them to NOTES.md under "## Bugs Found" as a short list. Do NOT edit code files.`;
}

/**
 * Builder fix prompt.
 */
export function iterateProject(_workDir: string, name: string, iteration: number): string {
  return `Fix the bugs listed in NOTES.md for "${name}". After fixing, append "ITERATION ${iteration} FIXES APPLIED" to NOTES.md.`;
}

/**
 * Tester retest prompt.
 */
export function retestProject(_workDir: string, name: string, _iteration: number): string {
  return `Re-check "${name}". Read index.html and NOTES.md. If bugs remain, update "## Bugs Found" in NOTES.md. If all fixed, write "ALL FIXES VERIFIED" in NOTES.md. Do NOT edit code files.`;
}

/**
 * Chat detection prompt.
 */
export function detectProjectRequest(chatText: string): string {
  return `Reading twitch chat. Is anyone requesting a coding project?

${chatText}

If yes: PROJECT: <name> | USER: <user> | DESC: <description>
If no: NONE`;
}
