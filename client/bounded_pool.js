export function pushBounded(items, item, maxItems, dispose) {
  items.push(item);
  while (items.length > maxItems) dispose(items.shift());
}

/**
 * Fixed-slot pool for render effects. Slots are allocated once and then moved
 * between `active` and `free`; release uses swap removal so it never shifts a
 * hot array. The caller owns visibility and final GPU disposal of each slot.
 */
export class ReusableEffectPool {
  constructor(maxItems, create, release) {
    this.maxItems = Math.max(0, Math.floor(maxItems) || 0);
    this.active = [];
    this.free = [];
    this.releaseSlot = release;
    this.peak = 0;
    this.nextSequence = 1;
    for (let index = 0; index < this.maxItems; index++) {
      const item = create(index);
      item._poolIndex = -1;
      item._poolSequence = 0;
      this.free.push(item);
    }
  }

  acquire(limit = this.maxItems) {
    const budget = Math.max(0, Math.min(this.maxItems, Math.floor(limit) || 0));
    if (budget === 0) {
      while (this.active.length > 0) this.release(this._oldestActive());
      return null;
    }
    while (this.active.length >= budget) this.release(this._oldestActive());
    const item = this.free.pop();
    if (!item) return null;
    item._poolIndex = this.active.length;
    item._poolSequence = this.nextSequence++;
    this.active.push(item);
    this.peak = Math.max(this.peak, this.active.length);
    return item;
  }

  release(item) {
    const index = item?._poolIndex;
    if (!Number.isInteger(index) || index < 0 || this.active[index] !== item) return false;
    const last = this.active.pop();
    if (last !== item) {
      this.active[index] = last;
      last._poolIndex = index;
    }
    item._poolIndex = -1;
    item._poolSequence = 0;
    this.releaseSlot?.(item);
    this.free.push(item);
    return true;
  }

  _oldestActive() {
    let oldest = this.active[0] || null;
    for (let index = 1; index < this.active.length; index++) {
      if (this.active[index]._poolSequence < oldest._poolSequence) oldest = this.active[index];
    }
    return oldest;
  }

  releaseAll() {
    while (this.active.length > 0) this.release(this.active[this.active.length - 1]);
  }
}
