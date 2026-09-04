/**
 * Delayed-job scheduling abstraction for the Day 3/7/14/30 sends.
 *
 * The in-process implementation below (setTimeout-based) is fine for local
 * dev and for the test suite, but is NOT durable: a server restart loses
 * every pending send, and it doesn't coordinate across multiple instances
 * (each would independently schedule its own timers off the same
 * enrollment, double-sending). For production, replace this with a durable
 * queue (BullMQ + Redis, or a DB table polled by a worker/cron) that
 * survives restarts and coordinates across instances -- the interface
 * below is intentionally minimal so that swap doesn't touch call sites.
 */

export interface Scheduler {
  scheduleAt(runAt: Date, job: () => Promise<void>): void;
}

export class InProcessScheduler implements Scheduler {
  private readonly timers: ReturnType<typeof setTimeout>[] = [];

  scheduleAt(runAt: Date, job: () => Promise<void>): void {
    const delayMs = Math.max(0, runAt.getTime() - Date.now());
    const timer = setTimeout(() => {
      job().catch((err) => {
        // A failed scheduled send should never crash the process -- log
        // and move on. In production this is where you'd push to a
        // dead-letter queue / alert rather than just console.error.
        console.error("[scheduler] scheduled job failed:", err);
      });
    }, delayMs);
    this.timers.push(timer);
  }

  /** Test/shutdown helper: cancel everything still pending. */
  cancelAll(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
  }
}
