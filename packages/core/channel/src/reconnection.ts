// @gonk/channel/base — ReconnectionManager: exponential backoff with jitter + a
// circuit breaker. gonk adds optional injection of `now`,
// `random`, and the timer pair so the backoff schedule is deterministically
// testable (no reliance on real timers / Math.random / Date.now). Defaults
// preserve the original behavior exactly.

export interface ReconnectionConfig {
  /** Enable automatic reconnection (default: true). */
  enabled?: boolean;
  /** Initial backoff delay in ms (default: 1000). */
  initialDelayMs?: number;
  /** Maximum backoff delay in ms (default: 30000). */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2). */
  multiplier?: number;
  /** Jitter factor 0-1 — fraction of delay added as random jitter (default: 0.25). */
  jitter?: number;
  /** Maximum consecutive reconnect attempts before circuit opens (default: 10). */
  maxRetries?: number;
  /** Circuit breaker reset timeout in ms — after opening, wait this long before half-open (default: 60000). */
  circuitResetMs?: number;
}

/** Injectable seams for deterministic testing. All default to the platform. */
export interface ReconnectionDeps {
  /** Current epoch ms (default: Date.now). */
  now?: () => number;
  /** A [0,1) source for jitter (default: Math.random). */
  random?: () => number;
  /** Schedule a callback after `ms` (default: setTimeout). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  /** Cancel a scheduled callback (default: clearTimeout). */
  clearTimer?: (handle: unknown) => void;
}

export type CircuitState = "closed" | "open" | "half-open";

export interface ReconnectionState {
  /** Number of consecutive failed attempts. */
  attempt: number;
  /** Current circuit breaker state. */
  circuit: CircuitState;
  /** Whether a reconnect is currently scheduled. */
  pending: boolean;
  /** Timestamp when circuit was opened (0 if closed). */
  circuitOpenedAt: number;
}

const DEFAULT_CONFIG: Required<ReconnectionConfig> = {
  enabled: true,
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
  multiplier: 2,
  jitter: 0.25,
  maxRetries: 10,
  circuitResetMs: 60_000,
};

export class ReconnectionManager {
  private config: Required<ReconnectionConfig>;
  private attempt = 0;
  private circuit: CircuitState = "closed";
  private circuitOpenedAt = 0;
  private timer: unknown = null;

  private now: () => number;
  private random: () => number;
  private setTimer: (fn: () => void, ms: number) => unknown;
  private clearTimer: (handle: unknown) => void;

  constructor(config?: ReconnectionConfig, deps?: ReconnectionDeps) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.now = deps?.now ?? (() => Date.now());
    this.random = deps?.random ?? (() => Math.random());
    this.setTimer = deps?.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps?.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  getState(): ReconnectionState {
    return {
      attempt: this.attempt,
      circuit: this.circuit,
      pending: this.timer !== null,
      circuitOpenedAt: this.circuitOpenedAt,
    };
  }

  /** The delay (ms) the NEXT scheduleReconnect would use, given current attempt
   *  state. Exposed so the backoff schedule is assertable without real timers. */
  nextDelay(): number {
    return this.computeDelay();
  }

  /**
   * Schedule a reconnect attempt. Calls `connectFn` after the computed delay.
   * Returns false if the circuit is open or reconnection is disabled.
   */
  scheduleReconnect(connectFn: () => Promise<void>): boolean {
    if (!this.config.enabled) return false;
    if (this.timer !== null) return true; // already scheduled

    // Check circuit
    if (this.circuit === "open") {
      const elapsed = this.now() - this.circuitOpenedAt;
      if (elapsed < this.config.circuitResetMs) {
        return false; // circuit still open
      }
      // Transition to half-open: allow one attempt
      this.circuit = "half-open";
    }

    if (this.attempt >= this.config.maxRetries && this.circuit !== "half-open") {
      this.openCircuit();
      return false;
    }

    const delay = this.computeDelay();
    this.timer = this.setTimer(() => {
      this.timer = null;
      void (async () => {
        try {
          await connectFn();
          this.onSuccess();
        } catch {
          this.onFailure();
          // Automatically schedule next attempt
          this.scheduleReconnect(connectFn);
        }
      })();
    }, delay);

    return true;
  }

  /** Call when connection succeeds (resets state). */
  onSuccess(): void {
    this.attempt = 0;
    this.circuit = "closed";
    this.circuitOpenedAt = 0;
    this.cancel();
  }

  /** Call when connection fails. */
  onFailure(): void {
    this.attempt++;
    if (this.circuit === "half-open") {
      this.openCircuit();
    } else if (this.attempt >= this.config.maxRetries) {
      this.openCircuit();
    }
  }

  /** Cancel any pending reconnect timer. */
  cancel(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  /** Reset all state. */
  reset(): void {
    this.cancel();
    this.attempt = 0;
    this.circuit = "closed";
    this.circuitOpenedAt = 0;
  }

  private openCircuit(): void {
    this.circuit = "open";
    this.circuitOpenedAt = this.now();
    this.cancel();
  }

  private computeDelay(): number {
    const base = Math.min(
      this.config.initialDelayMs * Math.pow(this.config.multiplier, this.attempt),
      this.config.maxDelayMs,
    );
    const jitterAmount = base * this.config.jitter * this.random();
    return Math.floor(base + jitterAmount);
  }
}
