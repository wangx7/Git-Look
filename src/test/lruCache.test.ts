import { LRUCache } from '../utils/lruCache';

describe('LRUCache', () => {
  it('should store and retrieve values in O(1)', () => {
    const cache = new LRUCache<string, number>({ capacity: 3 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(3);
  });

  it('should evict least recently used entry when capacity is exceeded', () => {
    const cache = new LRUCache<string, number>({ capacity: 3 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // Access 'a' so 'b' becomes LRU
    cache.get('a');

    // Add 'd', which should evict 'b'
    cache.set('d', 4);

    expect(cache.has('b')).toBe(false);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
    expect(cache.size).toBe(3);
  });

  it('should support entry update and move to MRU', () => {
    const cache = new LRUCache<string, number>({ capacity: 2 });
    cache.set('x', 10);
    cache.set('y', 20);

    // Update 'x'
    cache.set('x', 99);

    // Add 'z', should evict 'y' because 'x' was updated and moved to MRU
    cache.set('z', 30);

    expect(cache.get('x')).toBe(99);
    expect(cache.get('z')).toBe(30);
    expect(cache.has('y')).toBe(false);
  });

  it('should evict entries after TTL expiration', async () => {
    const cache = new LRUCache<string, string>({ defaultTtlMs: 20 });
    cache.set('short', 'lived');

    expect(cache.get('short')).toBe('lived');
    expect(cache.has('short')).toBe(true);

    // Wait for TTL to expire
    await new Promise(r => setTimeout(r, 30));

    expect(cache.get('short')).toBeUndefined();
    expect(cache.has('short')).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('should correctly delete and clear entries', () => {
    const cache = new LRUCache<string, string>({ capacity: 5 });
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');

    expect(cache.delete('k1')).toBe(true);
    expect(cache.delete('nonexistent')).toBe(false);
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('k2')).toBeUndefined();
  });

  it('should serialize composite keys deterministically without space collisions', () => {
    const key1 = LRUCache.serializeKey(['/path/to/repo', ['commit', '-m', 'hello world']]);
    const key2 = LRUCache.serializeKey(['/path/to/repo', ['commit', '-m', 'hello', 'world']]);

    expect(key1).not.toBe(key2);
  });
});
