export class FrameDriver {
  constructor(options) {
    this.document = options.document;
    this.onFrame = options.onFrame;
    this.requestAnimationFrame = options.requestAnimationFrame;
    this.cancelAnimationFrame = options.cancelAnimationFrame;
    this.setInterval = options.setInterval;
    this.clearInterval = options.clearInterval;
    this.rafId = null;
    this.intervalId = null;
    this.running = false;
    this.onVisibilityChange = () => this.sync();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.sync();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (this.rafId !== null) this.cancelAnimationFrame(this.rafId);
    if (this.intervalId !== null) this.clearInterval(this.intervalId);
    this.rafId = null;
    this.intervalId = null;
  }

  sync() {
    if (!this.running) return;
    if (this.document.visibilityState === 'hidden') {
      if (this.rafId !== null) {
        this.cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (this.intervalId === null) {
        this.intervalId = this.setInterval(() => this.onFrame(performance.now()), 1000 / 30);
      }
      return;
    }

    if (this.intervalId !== null) {
      this.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.rafId === null) {
      this.rafId = this.requestAnimationFrame(now => {
        this.rafId = null;
        if (!this.running) return;
        this.onFrame(now);
        this.sync();
      });
    }
  }
}
