export interface LRUCacheOptions {
  capacity?: number;
  defaultTtlMs?: number;
}

interface LRUNode<K, V> {
  key: K;
  value: V;
  expiresAt: number;
  prev: LRUNode<K, V> | null;
  next: LRUNode<K, V> | null;
}

/**
 * High-performance O(1) LRU (Least Recently Used) Cache with TTL support.
 * Implemented using a Doubly Linked List with Sentinel/Dummy Head and Tail,
 * backed by a JavaScript Map for O(1) key lookups.
 */
export class LRUCache<K, V> {
  private readonly capacity: number;
  private readonly defaultTtlMs: number;
  private readonly map: Map<K, LRUNode<K, V>>;
  private readonly head: LRUNode<K, V>;
  private readonly tail: LRUNode<K, V>;

  constructor(options: LRUCacheOptions = {}) {
    this.capacity = options.capacity ?? 500;
    this.defaultTtlMs = options.defaultTtlMs ?? 30000;
    this.map = new Map<K, LRUNode<K, V>>();

    // Sentinel dummy nodes to eliminate boundary checks
    this.head = {
      key: null as any,
      value: null as any,
      expiresAt: Infinity,
      prev: null,
      next: null
    };
    this.tail = {
      key: null as any,
      value: null as any,
      expiresAt: Infinity,
      prev: this.head,
      next: null
    };
    this.head.next = this.tail;
  }

  public get size(): number {
    return this.map.size;
  }

  /**
   * Retrieves value by key in O(1) time.
   * If entry is expired, it is evicted immediately and undefined is returned.
   * Otherwise, the node is moved to the head (most recently used).
   */
  public get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) {
      return undefined;
    }

    // Check expiration
    if (Date.now() > node.expiresAt) {
      this.removeNode(node);
      this.map.delete(key);
      return undefined;
    }

    // Move to front (MRU)
    this.moveToHead(node);
    return node.value;
  }

  /**
   * Inserts or updates an entry in O(1) time.
   * If capacity is exceeded, the least recently used entry (tail.prev) is evicted in O(1).
   */
  public set(key: K, value: V, ttlMs?: number): void {
    const ttl = ttlMs !== undefined ? ttlMs : this.defaultTtlMs;
    const expiresAt = ttl > 0 ? Date.now() + ttl : Infinity;

    let node = this.map.get(key);
    if (node) {
      node.value = value;
      node.expiresAt = expiresAt;
      this.moveToHead(node);
      return;
    }

    // Evict least recently used if at capacity
    if (this.map.size >= this.capacity) {
      this.evictTail();
    }

    // Insert new node at head
    const newNode: LRUNode<K, V> = {
      key,
      value,
      expiresAt,
      prev: null,
      next: null
    };
    this.insertAtHead(newNode);
    this.map.set(key, newNode);
  }

  public has(key: K): boolean {
    const node = this.map.get(key);
    if (!node) {
      return false;
    }
    if (Date.now() > node.expiresAt) {
      this.removeNode(node);
      this.map.delete(key);
      return false;
    }
    return true;
  }

  public delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) {
      return false;
    }
    this.removeNode(node);
    this.map.delete(key);
    return true;
  }

  public clear(): void {
    this.map.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  /**
   * Deterministic composite key serialization to prevent collisions on arguments with spaces.
   */
  public static serializeKey(parts: (string | number | boolean | object | null | undefined)[]): string {
    return JSON.stringify(parts);
  }

  private moveToHead(node: LRUNode<K, V>): void {
    this.removeNode(node);
    this.insertAtHead(node);
  }

  private insertAtHead(node: LRUNode<K, V>): void {
    node.prev = this.head;
    node.next = this.head.next;
    if (this.head.next) {
      this.head.next.prev = node;
    }
    this.head.next = node;
  }

  private removeNode(node: LRUNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    }
    node.prev = null;
    node.next = null;
  }

  private evictTail(): void {
    const lru = this.tail.prev;
    if (lru && lru !== this.head) {
      this.removeNode(lru);
      this.map.delete(lru.key);
    }
  }
}
