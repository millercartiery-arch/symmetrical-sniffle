import crypto from "crypto";

export interface QueueTask<T = unknown> {
  id: string;
  payload: T;
  enqueuedAt: number;
  attempts: number;
  maxAttempts: number;
  priority: number;
}

export interface QueueConsumeContext<T = unknown> {
  task: QueueTask<T>;
  workerId: number;
}

export interface QueueConsumeResult {
  ok: boolean;
  retry?: boolean;
  delayMs?: number;
}

export interface MessageQueueOptions {
  concurrency?: number;
  defaultMaxAttempts?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class AsyncSignal {
  private waiters: Array<() => void> = [];
  notify() {
    const list = this.waiters.splice(0, this.waiters.length);
    for (const w of list) w();
  }
  wait() {
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }
}

export class MessageQueueManager<T = unknown> {
  private queue: Array<QueueTask<T>> = [];
  private running = false;
  private paused = false;
  private signal = new AsyncSignal();
  private workers: Promise<void>[] = [];
  private inFlight = 0;

  constructor(private readonly options: MessageQueueOptions = {}) {}

  enqueue(payload: T, opts?: { maxAttempts?: number; taskId?: string; priority?: number }) {
    const task: QueueTask<T> = {
      id: opts?.taskId || crypto.randomUUID(),
      payload,
      enqueuedAt: Date.now(),
      attempts: 0,
      maxAttempts: Math.max(1, opts?.maxAttempts || this.options.defaultMaxAttempts || 3),
      priority: Number(opts?.priority || 0),
    };
    this.queue.push(task);
    this.signal.notify();
    return task.id;
  }

  enqueueBatch(items: Array<{ payload: T; taskId?: string; maxAttempts?: number; priority?: number }>) {
    return items.map((i) => this.enqueue(i.payload, { taskId: i.taskId, maxAttempts: i.maxAttempts, priority: i.priority }));
  }

  size() {
    return this.queue.length;
  }

  stats() {
    return {
      queued: this.queue.length,
      inFlight: this.inFlight,
      running: this.running,
      paused: this.paused,
      workers: this.workers.length,
    };
  }

  pauseConsume() {
    this.paused = true;
  }

  resumeConsume() {
    this.paused = false;
    this.signal.notify();
  }

  clearQueue() {
    const dropped = this.queue.length;
    this.queue = [];
    return dropped;
  }

  async start(handler: (ctx: QueueConsumeContext<T>) => Promise<QueueConsumeResult | void>) {
    if (this.running) return;
    this.running = true;
    const concurrency = Math.max(1, this.options.concurrency || 4);

    const runWorker = async (workerId: number) => {
      while (this.running) {
        if (this.paused) {
          await this.signal.wait();
          continue;
        }
        const task = this.dequeue();
        if (!task) {
          await this.signal.wait();
          continue;
        }

        this.inFlight += 1;
        try {
          task.attempts += 1;
          const result = (await handler({ task, workerId })) || { ok: true };
          if (!result.ok && (result.retry ?? true) && task.attempts < task.maxAttempts) {
            if (result.delayMs && result.delayMs > 0) await sleep(result.delayMs);
            this.queue.push(task);
            this.signal.notify();
          }
        } catch {
          if (task.attempts < task.maxAttempts) {
            this.queue.push(task);
            this.signal.notify();
          }
        } finally {
          this.inFlight = Math.max(0, this.inFlight - 1);
        }
      }
    };

    this.workers = Array.from({ length: concurrency }, (_, i) => runWorker(i + 1));
  }

  async stop() {
    this.running = false;
    this.signal.notify();
    await Promise.all(this.workers);
    this.workers = [];
  }

  private dequeue(): QueueTask<T> | undefined {
    if (!this.queue.length) return undefined;
    let pickIdx = 0;
    for (let i = 1; i < this.queue.length; i++) {
      const a = this.queue[i];
      const b = this.queue[pickIdx];
      if (a.priority > b.priority) {
        pickIdx = i;
        continue;
      }
      if (a.priority === b.priority && a.enqueuedAt < b.enqueuedAt) {
        pickIdx = i;
      }
    }
    const [task] = this.queue.splice(pickIdx, 1);
    return task;
  }
}
