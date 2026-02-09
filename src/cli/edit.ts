/**
 * deepreach edit -- open config files with the OS default application
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import * as clack from "@clack/prompts";
import {
  findWorkspaceRoot,
  profileJsonPath,
  preferencesJsonPath,
  resumeDir,
  envFilePath,
} from "./workspace";

// ============================================================================
// Editable targets
// ============================================================================

interface EditTarget {
  path: (root: string) => string;
  label: string;
}

const TARGETS: Record<string, EditTarget> = {
  profile: {
    path: profileJsonPath,
    label: "profile.json",
  },
  preferences: {
    path: preferencesJsonPath,
    label: "preferences.json",
  },
  resume: {
    path: resumeDir,
    label: "resume/",
  },
  env: {
    path: envFilePath,
    label: ".env",
  },
};

// ============================================================================
// Edit command
// ============================================================================

export async function runEdit(target: string, opts: { dir?: string } = {}) {
  // Resolve workspace
  const root = opts.dir ?? findWorkspaceRoot();
  if (!root) {
    clack.log.error(
      "No deepreach workspace found.\nRun `npx deepreach` to set one up, or use --dir to point to one."
    );
    process.exit(1);
  }

  const entry = TARGETS[target];
  if (!entry) {
    clack.log.error(
      `Unknown target "${target}". Choose one of: ${Object.keys(TARGETS).join(", ")}`
    );
    process.exit(1);
  }

  const targetPath = entry.path(root);

  if (!existsSync(targetPath)) {
    clack.log.error(`Not found: ${targetPath}\nRun \`npx deepreach\` first.`);
    process.exit(1);
  }

  clack.log.info(`Opening ${entry.label}...`);
  openWithOS(targetPath);
}

// ============================================================================
// Helpers
// ============================================================================

function openWithOS(targetPath: string) {
  const cmd =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "explorer" :
    "xdg-open";

  spawn(cmd, [targetPath], { detached: true, stdio: "ignore" }).unref();
}
