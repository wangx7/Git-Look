import { MinHeap } from '../utils/minHeap';

describe('MinHeap', () => {
  it('should maintain min-heap property with numbers', () => {
    const heap = new MinHeap<number>();
    heap.push(5);
    heap.push(3);
    heap.push(8);
    heap.push(1);
    heap.push(4);

    expect(heap.size).toBe(5);
    expect(heap.peek()).toBe(1);

    expect(heap.pop()).toBe(1);
    expect(heap.pop()).toBe(3);
    expect(heap.pop()).toBe(4);
    expect(heap.pop()).toBe(5);
    expect(heap.pop()).toBe(8);
    expect(heap.pop()).toBeUndefined();
    expect(heap.isEmpty).toBe(true);
  });

  it('should support custom comparator objects', () => {
    interface Task {
      priority: number;
      name: string;
    }

    const heap = new MinHeap<Task>((a, b) => a.priority - b.priority);
    heap.push({ priority: 10, name: 'Low' });
    heap.push({ priority: 1, name: 'Urgent' });
    heap.push({ priority: 5, name: 'Medium' });

    expect(heap.peek()?.name).toBe('Urgent');
    expect(heap.pop()?.name).toBe('Urgent');
    expect(heap.pop()?.name).toBe('Medium');
    expect(heap.pop()?.name).toBe('Low');
  });

  it('should clear all items', () => {
    const heap = new MinHeap<number>();
    heap.push(1);
    heap.push(2);
    heap.clear();

    expect(heap.size).toBe(0);
    expect(heap.isEmpty).toBe(true);
    expect(heap.peek()).toBeUndefined();
  });
});
