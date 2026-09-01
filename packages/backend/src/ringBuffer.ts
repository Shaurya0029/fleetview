/** Fixed-capacity circular buffer. O(1) push, oldest entries silently drop off. */
export class RingBuffer<T> {
  private buf: (T | undefined)[];
  private start = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.buf = new Array(capacity);
  }

  push(item: T): void {
    const idx = (this.start + this.count) % this.capacity;
    this.buf[idx] = item;
    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.start = (this.start + 1) % this.capacity;
    }
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i++) {
      out.push(this.buf[(this.start + i) % this.capacity] as T);
    }
    return out;
  }

  get size(): number {
    return this.count;
  }
}
