/**
 * Generic Binary Min-Heap (Priority Queue) implementation.
 * Used for optimal lane allocation, greedy interval graph coloring,
 * and O(log N) track recycling.
 */
export class MinHeap<T> {
  private heap: T[] = [];
  private readonly compare: (a: T, b: T) => number;

  constructor(compare?: (a: T, b: T) => number) {
    this.compare = compare || ((a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0));
  }

  public get size(): number {
    return this.heap.length;
  }

  public get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  public peek(): T | undefined {
    return this.heap[0];
  }

  public push(item: T): void {
    this.heap.push(item);
    this.siftUp(this.heap.length - 1);
  }

  public pop(): T | undefined {
    if (this.heap.length === 0) {
      return undefined;
    }
    const root = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return root;
  }

  public clear(): void {
    this.heap = [];
  }

  public toArray(): T[] {
    return [...this.heap];
  }

  private siftUp(index: number): void {
    let current = index;
    while (current > 0) {
      const parent = (current - 1) >> 1;
      if (this.compare(this.heap[current], this.heap[parent]) < 0) {
        this.swap(current, parent);
        current = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(index: number): void {
    let current = index;
    const length = this.heap.length;
    const halfLength = length >> 1;

    while (current < halfLength) {
      let left = (current << 1) + 1;
      const right = left + 1;
      let smallest = left;

      if (right < length && this.compare(this.heap[right], this.heap[left]) < 0) {
        smallest = right;
      }

      if (this.compare(this.heap[smallest], this.heap[current]) < 0) {
        this.swap(current, smallest);
        current = smallest;
      } else {
        break;
      }
    }
  }

  private swap(i: number, j: number): void {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;
  }
}
