// ─────────────────────────────────────────────────────────────────────────────
// @piggy/shared — Logger
//
// Thin structured logger. Uses pino in production, console in dev.
// All services import { logger } from "@piggy/shared" — never use console.log.
// ─────────────────────────────────────────────────────────────────────────────

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level:   LogLevel;
  time:    string;
  service: string;
  msg:     string;
  [key: string]: unknown;
}

function formatEntry(level: LogLevel, msg: string, meta?: object): LogEntry {
  return {
    level,
    time:    new Date().toISOString(),
    service: process.env.SERVICE_NAME ?? "piggy-sentinel",
    msg,
    ...meta,
  };
}

function write(level: LogLevel, msg: string, meta?: object): void {
  const entry = formatEntry(level, msg, meta);

  // In production, emit newline-delimited JSON (for log aggregators like Datadog/Loki)
  if (process.env.NODE_ENV === "production" || process.env.LOG_FORMAT === "json") {
    process.stdout.write(JSON.stringify(entry) + "\n");
    return;
  }

  // Dev: coloured human-readable output
  const colours: Record<LogLevel, string> = {
    debug: "\x1b[37m",   // white
    info:  "\x1b[36m",   // cyan
    warn:  "\x1b[33m",   // yellow
    error: "\x1b[31m",   // red
  };
  const reset = "\x1b[0m";
  const colour = colours[level] ?? "";

  const metaStr = meta && Object.keys(meta).length > 0
    ? " " + JSON.stringify(meta)
    : "";

  const line = `${colour}[${level.toUpperCase()}]${reset} ${entry.time.slice(11, 23)} ${msg}${metaStr}`;

  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const logger = {
  debug: (msg: string, meta?: object) => write("debug", msg, meta),
  info:  (msg: string, meta?: object) => write("info",  msg, meta),
  warn:  (msg: string, meta?: object) => write("warn",  msg, meta),
  error: (msg: string, meta?: object | unknown) => {
    // Accept Error objects as second arg (common pattern: logger.error("msg", err))
    if (meta instanceof Error) {
      write("error", msg, { err: meta.message, stack: meta.stack });
    } else {
      write("error", msg, meta as object | undefined);
    }
  },
} as const;
