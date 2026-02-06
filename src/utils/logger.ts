/**
 * Logger powered by consola
 *
 * Control verbosity via LOG_LEVEL env var or setLogLevel():
 *   - debug: all logs
 *   - info: info, warn, error
 *   - warn: warn, error only (default)
 *   - error: errors only
 *   - silent: no logs
 */

import { createConsola, LogLevels } from "consola";

// Map LOG_LEVEL env var to consola's numeric levels
const LOG_LEVEL_MAP: Record<string, number> = {
  debug: LogLevels.debug,   // 4
  info: LogLevels.info,     // 3
  warn: LogLevels.warn,     // 1
  error: LogLevels.error,   // 0
  silent: LogLevels.silent, // -Infinity
};

const envLevel = process.env.LOG_LEVEL?.toLowerCase() ?? "warn";

// Single base logger — all calls go through this so setLogLevel() always works.
// Output routed to stderr so it never corrupts interactive UI (clack spinners, prompts).
const base = createConsola({
  level: LOG_LEVEL_MAP[envLevel] ?? LogLevels.warn,
  stderr: process.stderr,
});
base.options.stdout = process.stderr;

/** Update log level at runtime (e.g. when --verbose flag is parsed) */
export function setLogLevel(name: "debug" | "info" | "warn" | "error" | "silent") {
  base.level = LOG_LEVEL_MAP[name] ?? LogLevels.warn;
}

// Module tag labels
const MODULE_TAGS: Record<string, string> = {
  cli: "CLI",
  orchestrator: "ORCH",
  hunter: "HUNTER",
  scoring: "SCORE",
  dedupe: "DEDUPE",
  template: "TMPL",
  tools: "TOOLS",
};

/** Create a tagged logger that always delegates to the base instance */
export function createLogger(module: string) {
  const tag = MODULE_TAGS[module] ?? module.toUpperCase();
  return {
    debug: (...args: unknown[]) => base.debug(`[${tag}]`, ...args),
    info: (...args: unknown[]) => base.info(`[${tag}]`, ...args),
    warn: (...args: unknown[]) => base.warn(`[${tag}]`, ...args),
    error: (...args: unknown[]) => base.error(`[${tag}]`, ...args),
  };
}

/** Pre-built loggers for each module */
export const logger = {
  cli: createLogger("cli"),
  orchestrator: createLogger("orchestrator"),
  hunter: createLogger("hunter"),
  scoring: createLogger("scoring"),
  dedupe: createLogger("dedupe"),
  template: createLogger("template"),
  tools: createLogger("tools"),
};
