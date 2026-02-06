/**
 * Workspace root discovery for deepreach CLI.
 *
 * Walks up from cwd (or a given start directory) looking for a `.deepreach/`
 * folder, similar to how git discovers `.git/`.  The directory containing
 * `.deepreach/` is the "workspace root" and all run/storage paths resolve
 * relative to it.
 */

import { existsSync } from "fs";
import { join, dirname } from "path";

// ============================================================================
// Constants
// ============================================================================

export const WORKSPACE_DIR_NAME = ".deepreach";

// ============================================================================
// Workspace root discovery
// ============================================================================

/**
 * Walk up the directory tree from `from` until we find a directory that
 * contains `.deepreach/`.  Returns the workspace root (the *parent* of
 * `.deepreach/`) or `null` if we hit the filesystem root without finding one.
 */
export function findWorkspaceRoot(from: string = process.cwd()): string | null {
  let dir = from;
  while (true) {
    if (existsSync(join(dir, WORKSPACE_DIR_NAME))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null; // filesystem root reached
    dir = parent;
  }
}

// ============================================================================
// Path helpers (all relative to workspace root)
// ============================================================================

/** Absolute path to the `.deepreach/` config directory */
export function configDir(root: string): string {
  return join(root, WORKSPACE_DIR_NAME);
}

/** Absolute path to the profile directory inside `.deepreach/` */
export function profileDir(root: string): string {
  return join(root, WORKSPACE_DIR_NAME);
}

/** Absolute path to `profile.json` */
export function profileJsonPath(root: string): string {
  return join(root, WORKSPACE_DIR_NAME, "profile.json");
}

/** Absolute path to `preferences.json` */
export function preferencesJsonPath(root: string): string {
  return join(root, WORKSPACE_DIR_NAME, "preferences.json");
}

/** Absolute path to the resume directory */
export function resumeDir(root: string): string {
  return join(root, WORKSPACE_DIR_NAME, "resume");
}

/** Absolute path to `resume.pdf` */
export function resumePdfPath(root: string): string {
  return join(root, WORKSPACE_DIR_NAME, "resume", "resume.pdf");
}

/** Absolute path to `resume.md` */
export function resumeMdPath(root: string): string {
  return join(root, WORKSPACE_DIR_NAME, "resume", "resume.md");
}

/** Absolute path to the `runs/` directory */
export function runsDir(root: string): string {
  return join(root, "runs");
}

/** Absolute path to a specific run directory */
export function runDir(root: string, runId: string): string {
  return join(root, "runs", runId);
}

/** Absolute path to the `storage/` directory */
export function storageDir(root: string): string {
  return join(root, "storage");
}

/** Absolute path to the `.env` file */
export function envFilePath(root: string): string {
  return join(root, ".env");
}
