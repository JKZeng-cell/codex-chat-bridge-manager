export class FlushController {
  constructor(doFlush) {
    this.doFlush = doFlush;
    this.flushInProgress = false;
    this.flushResolvers = [];
    this.needsReflush = false;
    this.pendingFlushTimer = null;
    this.lastUpdateTime = 0;
    this.completed = false;
    this.ready = false;
  }

  setReady(ready) {
    this.ready = ready;
    if (ready) {
      this.lastUpdateTime = Date.now();
    }
  }

  complete() {
    this.completed = true;
    this.cancelPendingFlush();
  }

  cancelPendingFlush() {
    if (this.pendingFlushTimer) {
      clearTimeout(this.pendingFlushTimer);
      this.pendingFlushTimer = null;
    }
  }

  waitForFlush() {
    if (!this.flushInProgress) {
      return Promise.resolve();
    }

    return new Promise((resolve) => this.flushResolvers.push(resolve));
  }

  async flush() {
    if (!this.ready || this.flushInProgress || this.completed) {
      if (this.flushInProgress && !this.completed) {
        this.needsReflush = true;
      }
      return;
    }

    this.flushInProgress = true;
    this.needsReflush = false;
    this.lastUpdateTime = Date.now();

    try {
      await this.doFlush();
      this.lastUpdateTime = Date.now();
    } finally {
      this.flushInProgress = false;
      const resolvers = this.flushResolvers;
      this.flushResolvers = [];
      for (const resolve of resolvers) {
        resolve();
      }

      if (this.needsReflush && !this.completed && !this.pendingFlushTimer) {
        this.needsReflush = false;
        this.pendingFlushTimer = setTimeout(() => {
          this.pendingFlushTimer = null;
          void this.flush();
        }, 0);
      }
    }
  }

  async throttledUpdate(throttleMs, batchAfterGapMs = 250, longGapThresholdMs = 2000) {
    if (!this.ready || this.completed) {
      return;
    }

    const now = Date.now();
    const elapsed = now - this.lastUpdateTime;

    if (elapsed >= throttleMs) {
      this.cancelPendingFlush();

      if (elapsed > longGapThresholdMs) {
        this.lastUpdateTime = now;
        this.pendingFlushTimer = setTimeout(() => {
          this.pendingFlushTimer = null;
          void this.flush();
        }, batchAfterGapMs);
        return;
      }

      await this.flush();
      return;
    }

    if (!this.pendingFlushTimer) {
      const delay = throttleMs - elapsed;
      this.pendingFlushTimer = setTimeout(() => {
        this.pendingFlushTimer = null;
        void this.flush();
      }, delay);
    }
  }
}
