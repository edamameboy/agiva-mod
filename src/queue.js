// queue.js — Event queue system, anti-overlap, prevents concurrent effects
'use strict';

class EventQueue {
  constructor(config = {}) {
    this.maxSize = config.maxQueueSize || 10;
    this.minDelay = config.minDelayBetweenEffects || 500;
    this.dropOnFull = config.dropOnFull || false;
    this.queue = [];
    this.processing = false;
    this.lastProcessedAt = 0;
    this.onProcess = null; // callback(item)
  }

  setProcessor(fn) {
    this.onProcess = fn;
  }

  enqueue(item) {
    if (this.queue.length >= this.maxSize) {
      if (this.dropOnFull) {
        console.log(`[Queue] Full (${this.maxSize}), dropping: ${item.effectId}`);
        return false;
      }
      // Drop oldest non-critical item
      const dropIdx = this.queue.findIndex(i => i.priority !== 'high');
      if (dropIdx !== -1) {
        this.queue.splice(dropIdx, 1);
        console.log(`[Queue] Dropped oldest item to make room`);
      }
    }
    this.queue.push(item);
    this._processNext();
    return true;
  }

  async _processNext() {
    if (this.processing || this.queue.length === 0) return;

    const now = Date.now();
    const wait = this.minDelay - (now - this.lastProcessedAt);
    if (wait > 0) {
      setTimeout(() => this._processNext(), wait);
      return;
    }

    this.processing = true;
    const item = this.queue.shift();
    this.lastProcessedAt = Date.now();

    try {
      if (this.onProcess) await this.onProcess(item);
    } catch (e) {
      console.error('[Queue] Error processing item:', e.message);
    }

    // Wait for effect duration before next
    const duration = item.duration || 0;
    setTimeout(() => {
      this.processing = false;
      this._processNext();
    }, Math.max(this.minDelay, duration));
  }

  clear() {
    this.queue = [];
  }

  get length() {
    return this.queue.length;
  }

  get status() {
    return {
      queued: this.queue.length,
      processing: this.processing,
      items: this.queue.map(i => ({ effectId: i.effectId, user: i.user }))
    };
  }
}

module.exports = EventQueue;
