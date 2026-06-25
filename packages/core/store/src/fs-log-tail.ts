/** Cross-process tail over the fs LogStore's `log.jsonl`.
 *
 *  `LogStore.append` (fs-backend) appends one JSONL line per record and returns
 *  the record's byte offset. `tailLog` watches that file with `fs.watch` and
 *  delivers every record appended AFTER the tail started (or from a caller-chosen
 *  `startOffset`) — across processes, with NO shared in-memory state.
 *
 *  This is the cross-process observation primitive the self-wake slice (Part 2)
 *  rides. `@gonk/channel`'s `Emitter` is in-process only; this tail is what makes
 *  a detached worker's terminal transition visible to the parent that spawned it
 *  (the worker `append`s; the parent `tail`s the same on-disk log).
 *
 *  Robustness: fs.watch is the primary (event-driven) trigger. Each event
 *  re-reads `[offset, EOF)` and parses every complete line, so coalesced or
 *  batched appends all deliver. The tail is robust to the single-writer offset
 *  race (GR-09) because it reads forward by line, not by stored offset. An
 *  optional `pollMs` safety net (default 250ms) re-scans on a timer to bound
 *  delivery latency; the primary path is event-driven, not a busy poller. */

import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { dirname, join } from "node:path";

/** Matches `FsStoreBackend`'s on-disk log filename (the JSONL append log). */
const LOG_FILE = "log.jsonl";

/** One delivered record: its parsed value and the byte offset where its line
 *  begins (the value `LogStore.append` would have returned for it). */
export interface LogTailRecord<R> {
  record: R;
  offset: number;
}

/** A handle to stop a tail. Idempotent. */
export interface LogTail {
  close(): void;
}

export interface TailLogOptions<R> {
  /** The resolved store dir for the (tier, namespace) — the parent of
   *  `log.jsonl`. Obtain it with `resolveStoreDir(scope, tier, namespace)`. */
  dir: string;
  /** Fired once per appended record, in append order, with the parsed value and
   *  byte offset. Throwing here stops delivery to later records for that scan. */
  onRecord: (e: LogTailRecord<R>) => void;
  /** Byte offset to resume from. Default: the current end of the file, so only
   *  records appended AFTER the tail starts are delivered (`tail -f` semantics).
   *  Pass 0 to replay existing history on attach. */
  startOffset?: number;
  /** Bounded-delivery-latency safety net (ms). Re-scans on a timer so an append
   *  is never missed even when fs.watch drops or coalesces events. DEFAULT 250;
   *  the timer is `unref`'d (never keeps the process alive). Pass 0 to disable
   *  (fs.watch-only). fs.watch remains the primary instant trigger on top. */
  pollMs?: number;
  /** Swallows fs.watch errors (the file being rotated, the host dropping the
   *    watch). When omitted, errors are ignored — the next scan recovers. */
  onError?: (err: Error) => void;
}

/** Tail a store log dir for appended records, cross-process. Returns a handle
 *  whose `close()` stops watching. See `TailLogOptions` for the contract. */
export function tailLog<R>(opts: TailLogOptions<R>): LogTail {
  const { dir, onRecord, onError } = opts;
  const logPath = join(dir, LOG_FILE);

  let offset = opts.startOffset ?? currentSize(logPath);
  let closed = false;
  let watcher: FSWatcher | null = null;
  let pollTimer: NodeJS.Timeout | null = null;

  // Read every complete line in [offset, EOF), parse + deliver each, advance.
  const scan = (): void => {
    if (closed) return;
    if (!existsSync(logPath)) return;
    const size = statSync(logPath).size;
    if (size <= offset) return;
    const fd = openSync(logPath, "r");
    try {
      let lineStart = offset;
      const chunk = Buffer.alloc(size - offset);
      readSync(fd, chunk, 0, chunk.length, offset);
      const text = chunk.toString("utf8");
      // Walk the lines by tracking byte positions; the trailing partial line
      // (no newline yet — a record mid-append) is left for the next scan.
      let cursor = 0;
      while (cursor < text.length) {
        const nl = text.indexOf("\n", cursor);
        if (nl === -1) break; // incomplete trailing line; wait for the next scan
        const line = text.slice(cursor, nl);
        const lineOffset = lineStart + cursor;
        cursor = nl + 1;
        if (line.length === 0) continue;
        try {
          const record = JSON.parse(line) as R;
          onRecord({ record, offset: lineOffset });
        } catch {
          // malformed line — skip, do not advance past a record we couldn't parse
          // (the offset advance below handles byte progression regardless)
        }
      }
      offset = lineStart + cursor; // committed up to the last newline
    } finally {
      closeSync(fd);
    }
  };

  const stop = (): void => {
    closed = true;
    watcher?.close();
    watcher = null;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  // Watch the file when it exists; watch its parent dir for creation otherwise.
  const watchFile = (): void => {
    watcher = watch(logPath, () => scan());
    watcher.on("error", (err) => {
      if (onError) onError(err);
      // a transient watch drop is recoverable on the next dir event / poll
    });
  };

  if (existsSync(logPath)) {
    scan(); // deliver anything already past the start offset
    watchFile();
  } else {
    // The log file may not exist yet (no appends). Watch the parent dir; when
    // log.jsonl appears, switch to a direct file watch. The dir always exists
    // once the store dir is resolved/created.
    const parent = dirname(logPath);
    watcher = watch(parent, (_event, file) => {
      if (closed) return;
      if (file === LOG_FILE && existsSync(logPath)) {
        watcher?.close();
        scan();
        watchFile();
      }
    });
    watcher.on("error", (err) => onError?.(err));
  }

  if ((opts.pollMs ?? 250) > 0) {
    pollTimer = setInterval(scan, opts.pollMs ?? 250);
    pollTimer.unref();
  }

  return { close: stop };
}

/** Current byte size of the log file, or 0 if it does not yet exist. */
function currentSize(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}
