export class TaskQueue {
  constructor(concurrency = 1) {
    this.concurrency = Math.max(1, concurrency);
    this.activeCount = 0;
    this.pending = [];
  }

  push(task) {
    return new Promise((resolve, reject) => {
      this.pending.push({ task, resolve, reject });
      this.#drain();
    });
  }

  snapshot() {
    return {
      activeCount: this.activeCount,
      pendingCount: this.pending.length
    };
  }

  #drain() {
    while (this.activeCount < this.concurrency && this.pending.length > 0) {
      const next = this.pending.shift();
      this.activeCount += 1;

      Promise.resolve()
        .then(() => next.task())
        .then(next.resolve, next.reject)
        .finally(() => {
          this.activeCount -= 1;
          this.#drain();
        });
    }
  }
}
