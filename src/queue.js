// queue.js — Priority Multi-Lane Event Queue (prevents keystroke macros from blocking ws-mod / rcon)
'use strict';

class EventQueue {
  constructor(config = {}) {
    this.maxSize = config.maxQueueSize || 100;
    this.minDelay = config.minDelayBetweenEffects ?? 500;
    this.dropOnFull = config.dropOnFull || false;
    this.lanes = new Map();
    this.onProcess = null; // async callback(item)
  }

  _getLane(laneKey = 'default') {
    const key = String(laneKey || 'default');
    if (!this.lanes.has(key)) {
      this.lanes.set(key, {
        queue: [],
        processing: false,
        lastProcessedAt: 0,
        timer: null
      });
    }
    return this.lanes.get(key);
  }

  setProcessor(fn) {
    this.onProcess = fn;
  }

  updateSettings(config = {}) {
    if (config.maxQueueSize !== undefined) {
      this.maxSize = Math.max(1, Math.min(1000, Number(config.maxQueueSize) || 100));
    }
    if (config.minDelayBetweenEffects !== undefined) {
      this.minDelay = Math.max(0, Math.min(60000, Number(config.minDelayBetweenEffects) || 0));
    }
    if (config.dropOnFull !== undefined) {
      this.dropOnFull = Boolean(config.dropOnFull);
    }
  }

  _dropOneFromBusiestLane() {
    let busiest = null;
    for (const lane of this.lanes.values()) {
      if (lane.queue.length > 0 && (!busiest || lane.queue.length > busiest.queue.length)) {
        busiest = lane;
      }
    }
    if (!busiest) return;
    const dropIdx = busiest.queue.findIndex(i => i.priority !== 'high');
    if (dropIdx !== -1) {
      busiest.queue.splice(dropIdx, 1);
      console.log('[Queue] Dropped oldest normal-priority item to make room');
    } else {
      busiest.queue.shift();
    }
  }

  enqueue(item) {
    if (this.length >= this.maxSize) {
      if (this.dropOnFull) {
        console.log(`[Queue] Full (${this.maxSize}), dropping: ${item.effectId}`);
        return false;
      }
      this._dropOneFromBusiestLane();
    }

    const laneKey = String(item?.lane || item?.driver || 'default');
    const lane = this._getLane(laneKey);

    if (item && item.priority === 'high') {
      let insertIdx = 0;
      while (insertIdx < lane.queue.length && lane.queue[insertIdx].priority === 'high') {
        insertIdx++;
      }
      lane.queue.splice(insertIdx, 0, item);
    } else {
      lane.queue.push(item);
    }

    this._processNext(laneKey);
    return true;
  }

  async _processNext(laneKey = 'default') {
    const lane = this._getLane(laneKey);
    if (lane.processing || lane.queue.length === 0) return;

    lane.processing = true;
    const now = Date.now();
    const wait = Math.max(0, this.minDelay - (now - lane.lastProcessedAt));
    if (wait > 0) {
      lane.timer = setTimeout(() => {
        lane.timer = null;
        lane.processing = false;
        this._processNext(laneKey);
      }, wait);
      return;
    }

    const item = lane.queue.shift();
    lane.lastProcessedAt = Date.now();

    try {
      if (this.onProcess) await this.onProcess(item);
    } catch (e) {
      console.error(`[Queue:${laneKey}] Error processing item:`, e.message);
    }

    const duration = item?.duration || 0;
    lane.timer = setTimeout(() => {
      lane.timer = null;
      lane.processing = false;
      this._processNext(laneKey);
    }, Math.max(this.minDelay, duration));
  }

  clear() {
    for (const lane of this.lanes.values()) {
      lane.queue = [];
      if (lane.timer) {
        clearTimeout(lane.timer);
        lane.timer = null;
      }
      lane.processing = false;
    }
  }

  get length() {
    let total = 0;
    for (const lane of this.lanes.values()) {
      total += lane.queue.length;
    }
    return total;
  }

  get status() {
    const items = [];
    const lanes = {};
    let processing = false;
    for (const [key, lane] of this.lanes.entries()) {
      if (lane.processing) processing = true;
      lanes[key] = {
        queued: lane.queue.length,
        processing: lane.processing
      };
      for (const i of lane.queue) {
        items.push({ effectId: i.effectId, user: i.user, lane: key });
      }
    }
    return {
      queued: items.length,
      processing,
      items,
      lanes
    };
  }
}

module.exports = EventQueue;
