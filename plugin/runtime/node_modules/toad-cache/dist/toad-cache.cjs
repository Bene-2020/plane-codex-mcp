/**
 * toad-cache
 *
 * @copyright 2026 Igor Savin <kibertoad@gmail.com>
 * @license MIT
 * @version 3.7.3
 */
'use strict';

/**
 * Validates the shared cache constructor parameters.
 * Both values must be non-negative integers.
 *
 * @param {number} max
 * @param {number} ttlInMsecs
 */
function validateCacheParams(max, ttlInMsecs) {
  if (typeof max !== 'number' || !Number.isInteger(max) || max < 0) {
    throw new Error('Invalid max value')
  }

  if (typeof ttlInMsecs !== 'number' || !Number.isInteger(ttlInMsecs) || ttlInMsecs < 0) {
    throw new Error('Invalid ttl value')
  }
}

class FifoMap {
  constructor(max = 1000, ttlInMsecs = 0) {
    validateCacheParams(max, ttlInMsecs);

    this.first = null;
    this.items = new Map();
    this.last = null;
    this.max = max;
    this.ttl = ttlInMsecs;
  }

  get size() {
    return this.items.size
  }

  clear() {
    this.items.clear();
    this.first = null;
    this.last = null;
  }

  delete(key) {
    const deletedItem = this.items.get(key);

    if (deletedItem !== undefined) {
      this.items.delete(key);

      if (deletedItem.prev !== null) {
        deletedItem.prev.next = deletedItem.next;
      }

      if (deletedItem.next !== null) {
        deletedItem.next.prev = deletedItem.prev;
      }

      if (this.first === deletedItem) {
        this.first = deletedItem.next;
      }

      if (this.last === deletedItem) {
        this.last = deletedItem.prev;
      }
    }
  }

  deleteMany(keys) {
    for (var i = 0; i < keys.length; i++) {
      this.delete(keys[i]);
    }
  }

  evict() {
    if (this.size > 0) {
      const item = this.first;

      this.items.delete(item.key);

      if (this.size === 0) {
        this.first = null;
        this.last = null;
      } else {
        this.first = item.next;
        this.first.prev = null;
      }
    }
  }

  expiresAt(key) {
    const item = this.items.get(key);

    if (item !== undefined) {
      return item.expiry
    }
  }

  get(key) {
    const item = this.items.get(key);

    if (item !== undefined) {
      if (this.ttl > 0 && item.expiry <= Date.now()) {
        this.delete(key);
        return
      }

      return item.value
    }
  }

  getMany(keys) {
    const result = new Array(keys.length);

    for (var i = 0; i < keys.length; i++) {
      result[i] = this.get(keys[i]);
    }

    return result
  }

  keys() {
    return this.items.keys()
  }

  set(key, value) {
    // Replace existing item
    const existing = this.items.get(key);

    if (existing !== undefined) {
      existing.value = value;
      existing.expiry = this.ttl > 0 ? Date.now() + this.ttl : this.ttl;

      return
    }

    // Add new item
    if (this.max > 0 && this.size >= this.max) {
      this.evict();
    }

    const item = {
      expiry: this.ttl > 0 ? Date.now() + this.ttl : this.ttl,
      key: key,
      prev: this.last,
      next: null,
      value,
    };
    this.items.set(key, item);

    if (this.size === 1) {
      this.first = item;
    } else {
      this.last.next = item;
    }

    this.last = item;
  }
}

class FifoObject {
  constructor(max = 1000, ttlInMsecs = 0) {
    validateCacheParams(max, ttlInMsecs);

    this.first = null;
    this.items = Object.create(null);
    this.last = null;
    this.size = 0;
    this.max = max;
    this.ttl = ttlInMsecs;
  }

  clear() {
    this.items = Object.create(null);
    this.first = null;
    this.last = null;
    this.size = 0;
  }

  delete(key) {
    const deletedItem = this.items[key];

    if (deletedItem !== undefined) {
      delete this.items[key];
      this.size--;

      if (deletedItem.prev !== null) {
        deletedItem.prev.next = deletedItem.next;
      }

      if (deletedItem.next !== null) {
        deletedItem.next.prev = deletedItem.prev;
      }

      if (this.first === deletedItem) {
        this.first = deletedItem.next;
      }

      if (this.last === deletedItem) {
        this.last = deletedItem.prev;
      }
    }
  }

  deleteMany(keys) {
    for (var i = 0; i < keys.length; i++) {
      this.delete(keys[i]);
    }
  }

  evict() {
    if (this.size > 0) {
      const item = this.first;

      delete this.items[item.key];

      if (--this.size === 0) {
        this.first = null;
        this.last = null;
      } else {
        this.first = item.next;
        this.first.prev = null;
      }
    }
  }

  expiresAt(key) {
    const item = this.items[key];

    if (item !== undefined) {
      return item.expiry
    }
  }

  get(key) {
    const item = this.items[key];

    if (item !== undefined) {
      if (this.ttl > 0 && item.expiry <= Date.now()) {
        this.delete(key);
        return
      }

      return item.value
    }
  }

  getMany(keys) {
    const result = new Array(keys.length);

    for (var i = 0; i < keys.length; i++) {
      result[i] = this.get(keys[i]);
    }

    return result
  }

  keys() {
    return Object.keys(this.items)
  }

  set(key, value) {
    // Replace existing item
    const existing = this.items[key];

    if (existing !== undefined) {
      existing.value = value;
      existing.expiry = this.ttl > 0 ? Date.now() + this.ttl : this.ttl;

      return
    }

    // Add new item
    if (this.max > 0 && this.size >= this.max) {
      this.evict();
    }

    const item = {
      expiry: this.ttl > 0 ? Date.now() + this.ttl : this.ttl,
      key: key,
      prev: this.last,
      next: null,
      value,
    };
    this.items[key] = item;

    if (++this.size === 1) {
      this.first = item;
    } else {
      this.last.next = item;
    }

    this.last = item;
  }
}

/**
 * Creates a zeroed statistics record for a single collection window.
 *
 * @returns {object}
 */
function createEmptyStatisticsRecord() {
  return {
    cacheSize: 0,
    hits: 0,
    falsyHits: 0,
    emptyHits: 0,
    misses: 0,
    expirations: 0,
    evictions: 0,
    invalidateOne: 0,
    invalidateAll: 0,
    sets: 0,
  }
}

class HitStatisticsRecord {
  constructor() {
    this.records = {};
  }

  initForCache(cacheId, currentTimeStamp) {
    this.records[cacheId] = {
      [currentTimeStamp]: createEmptyStatisticsRecord(),
    };
  }

  resetForCache(cacheId) {
    if (!this.records[cacheId]) {
      return
    }

    for (let key of Object.keys(this.records[cacheId])) {
      this.records[cacheId][key] = createEmptyStatisticsRecord();
    }
  }

  getStatistics() {
    return this.records
  }
}

class LruMap {
  constructor(max = 1000, ttlInMsecs = 0) {
    validateCacheParams(max, ttlInMsecs);

    this.first = null;
    this.items = new Map();
    this.last = null;
    this.max = max;
    this.ttl = ttlInMsecs;
  }

  get size() {
    return this.items.size
  }

  bumpLru(item) {
    if (this.last === item) {
      return // Item is already the last one, no need to bump
    }

    const last = this.last;
    const next = item.next;
    const prev = item.prev;

    if (this.first === item) {
      this.first = next;
    }

    item.next = null;
    item.prev = last;
    last.next = item;

    if (prev !== null) {
      prev.next = next;
    }

    /* v8 ignore next 3 -- next is always non-null here: the early return above guarantees item !== this.last in a well-formed list */
    if (next !== null) {
      next.prev = prev;
    }

    this.last = item;
  }

  clear() {
    this.items.clear();
    this.first = null;
    this.last = null;
  }

  delete(key) {
    const item = this.items.get(key);

    if (item !== undefined) {
      this.items.delete(key);

      if (item.prev !== null) {
        item.prev.next = item.next;
      }

      if (item.next !== null) {
        item.next.prev = item.prev;
      }

      if (this.first === item) {
        this.first = item.next;
      }

      if (this.last === item) {
        this.last = item.prev;
      }
    }
  }

  deleteMany(keys) {
    for (var i = 0; i < keys.length; i++) {
      this.delete(keys[i]);
    }
  }

  evict() {
    if (this.size > 0) {
      const item = this.first;

      this.items.delete(item.key);

      if (this.size === 0) {
        this.first = null;
        this.last = null;
      } else {
        this.first = item.next;
        this.first.prev = null;
      }
    }
  }

  expiresAt(key) {
    const item = this.items.get(key);

    if (item !== undefined) {
      return item.expiry
    }
  }

  get(key) {
    const item = this.items.get(key);

    if (item !== undefined) {
      // Item has already expired
      if (this.ttl > 0 && item.expiry <= Date.now()) {
        this.delete(key);
        return
      }

      // Item is still fresh
      this.bumpLru(item);
      return item.value
    }
  }

  getMany(keys) {
    const result = new Array(keys.length);

    for (var i = 0; i < keys.length; i++) {
      result[i] = this.get(keys[i]);
    }

    return result
  }

  keys() {
    return this.items.keys()
  }

  set(key, value) {
    // Replace existing item
    const existing = this.items.get(key);

    if (existing !== undefined) {
      existing.value = value;
      existing.expiry = this.ttl > 0 ? Date.now() + this.ttl : this.ttl;
      this.bumpLru(existing);

      return
    }

    // Add new item
    if (this.max > 0 && this.size >= this.max) {
      this.evict();
    }

    const item = {
      expiry: this.ttl > 0 ? Date.now() + this.ttl : this.ttl,
      key: key,
      prev: this.last,
      next: null,
      value,
    };
    this.items.set(key, item);

    if (this.size === 1) {
      this.first = item;
    } else {
      this.last.next = item;
    }

    this.last = item;
  }
}

class LruObject {
  constructor(max = 1000, ttlInMsecs = 0) {
    validateCacheParams(max, ttlInMsecs);

    this.first = null;
    this.items = Object.create(null);
    this.last = null;
    this.size = 0;
    this.max = max;
    this.ttl = ttlInMsecs;
  }

  bumpLru(item) {
    if (this.last === item) {
      return // Item is already the last one, no need to bump
    }

    const last = this.last;
    const next = item.next;
    const prev = item.prev;

    if (this.first === item) {
      this.first = next;
    }

    item.next = null;
    item.prev = last;
    last.next = item;

    if (prev !== null) {
      prev.next = next;
    }

    /* v8 ignore next 3 -- next is always non-null here: the early return above guarantees item !== this.last in a well-formed list */
    if (next !== null) {
      next.prev = prev;
    }

    this.last = item;
  }

  clear() {
    this.items = Object.create(null);
    this.first = null;
    this.last = null;
    this.size = 0;
  }

  delete(key) {
    const item = this.items[key];

    if (item !== undefined) {
      delete this.items[key];
      this.size--;

      if (item.prev !== null) {
        item.prev.next = item.next;
      }

      if (item.next !== null) {
        item.next.prev = item.prev;
      }

      if (this.first === item) {
        this.first = item.next;
      }

      if (this.last === item) {
        this.last = item.prev;
      }
    }
  }

  deleteMany(keys) {
    for (var i = 0; i < keys.length; i++) {
      this.delete(keys[i]);
    }
  }

  evict() {
    if (this.size > 0) {
      const item = this.first;

      delete this.items[item.key];

      if (--this.size === 0) {
        this.first = null;
        this.last = null;
      } else {
        this.first = item.next;
        this.first.prev = null;
      }
    }
  }

  expiresAt(key) {
    const item = this.items[key];

    if (item !== undefined) {
      return item.expiry
    }
  }

  get(key) {
    const item = this.items[key];

    if (item !== undefined) {
      // Item has already expired
      if (this.ttl > 0 && item.expiry <= Date.now()) {
        this.delete(key);
        return
      }

      // Item is still fresh
      this.bumpLru(item);
      return item.value
    }
  }

  getMany(keys) {
    const result = new Array(keys.length);

    for (var i = 0; i < keys.length; i++) {
      result[i] = this.get(keys[i]);
    }

    return result
  }

  keys() {
    return Object.keys(this.items)
  }

  set(key, value) {
    // Replace existing item
    const existing = this.items[key];

    if (existing !== undefined) {
      existing.value = value;
      existing.expiry = this.ttl > 0 ? Date.now() + this.ttl : this.ttl;
      this.bumpLru(existing);

      return
    }

    // Add new item
    if (this.max > 0 && this.size >= this.max) {
      this.evict();
    }

    const item = {
      expiry: this.ttl > 0 ? Date.now() + this.ttl : this.ttl,
      key: key,
      prev: this.last,
      next: null,
      value,
    };
    this.items[key] = item;

    if (++this.size === 1) {
      this.first = item;
    } else {
      this.last.next = item;
    }

    this.last = item;
  }
}

/**
 *
 * @param {Date} date
 * @returns {string}
 */
function getTimestamp(date) {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date
    .getDate()
    .toString()
    .padStart(2, '0')}`
}

class HitStatistics {
  constructor(cacheId, statisticTtlInHours, globalStatisticsRecord) {
    this.cacheId = cacheId;
    this.statisticTtlInHours = statisticTtlInHours;

    this.collectionStart = new Date();
    this.currentTimeStamp = getTimestamp(this.collectionStart);
    this.archiveAfter = this.collectionStart.getTime() + this.statisticTtlInHours * 3_600_000;

    this.records = globalStatisticsRecord || new HitStatisticsRecord();
    this.records.initForCache(this.cacheId, this.currentTimeStamp);
  }

  get currentRecord() {
    const cacheRecords = this.records.records[this.cacheId];
    // safety net
    /* c8 ignore next 3 */
    if (!cacheRecords[this.currentTimeStamp]) {
      cacheRecords[this.currentTimeStamp] = createEmptyStatisticsRecord();
    }

    return cacheRecords[this.currentTimeStamp]
  }

  /* v8 ignore next 3 -- kept for compatibility, no longer used internally */
  hoursPassed() {
    return (Date.now() - this.collectionStart) / 1000 / 60 / 60
  }

  addHit() {
    this.archiveIfNeeded();
    this.currentRecord.hits++;
  }
  addFalsyHit() {
    this.archiveIfNeeded();
    this.currentRecord.falsyHits++;
  }

  addEmptyHit() {
    this.archiveIfNeeded();
    this.currentRecord.emptyHits++;
  }

  addMiss() {
    this.archiveIfNeeded();
    this.currentRecord.misses++;
  }

  addEviction() {
    this.archiveIfNeeded();
    this.currentRecord.evictions++;
  }

  setCacheSize(currentSize) {
    this.archiveIfNeeded();
    this.currentRecord.cacheSize = currentSize;
  }

  addExpiration() {
    this.archiveIfNeeded();
    this.currentRecord.expirations++;
  }

  addSet() {
    this.archiveIfNeeded();
    this.currentRecord.sets++;
  }

  addInvalidateOne() {
    this.archiveIfNeeded();
    this.currentRecord.invalidateOne++;
  }

  addInvalidateAll() {
    this.archiveIfNeeded();
    this.currentRecord.invalidateAll++;
  }

  getStatistics() {
    return this.records.getStatistics()
  }

  archiveIfNeeded() {
    if (Date.now() >= this.archiveAfter) {
      this.collectionStart = new Date();
      this.currentTimeStamp = getTimestamp(this.collectionStart);
      this.archiveAfter = this.collectionStart.getTime() + this.statisticTtlInHours * 3_600_000;
      this.records.initForCache(this.cacheId, this.currentTimeStamp);
    }
  }
}

class LruObjectHitStatistics extends LruObject {
  constructor(max, ttlInMsecs, cacheId, globalStatisticsRecord, statisticTtlInHours) {
    // Pass through as-is: the base constructor applies the 1000/0 defaults for
    // omitted (undefined) values and validates everything else, so explicit 0
    // stays unlimited and null/NaN are rejected the same way as the base class.
    super(max, ttlInMsecs);

    if (!cacheId) {
      throw new Error('Cache id is mandatory')
    }

    this.hitStatistics = new HitStatistics(
      cacheId,
      statisticTtlInHours !== undefined ? statisticTtlInHours : 24,
      globalStatisticsRecord,
    );
  }

  getStatistics() {
    return this.hitStatistics.getStatistics()
  }

  set(key, value) {
    super.set(key, value);
    this.hitStatistics.addSet();
    this.hitStatistics.setCacheSize(this.size);
  }

  evict() {
    const hadItems = this.size > 0;
    super.evict();
    if (hadItems) {
      this.hitStatistics.addEviction();
    }
    this.hitStatistics.setCacheSize(this.size);
  }

  delete(key, isExpiration = false) {
    const existed = this.items[key] !== undefined;
    super.delete(key);

    if (existed && !isExpiration) {
      this.hitStatistics.addInvalidateOne();
    }
    this.hitStatistics.setCacheSize(this.size);
  }

  clear() {
    super.clear();

    this.hitStatistics.addInvalidateAll();
    this.hitStatistics.setCacheSize(this.size);
  }

  get(key) {
    const item = this.items[key];

    if (item !== undefined) {
      // Item has already expired
      if (this.ttl > 0 && item.expiry <= Date.now()) {
        this.delete(key, true);
        this.hitStatistics.addExpiration();
        return
      }

      // Item is still fresh
      this.bumpLru(item);
      if (!item.value) {
        this.hitStatistics.addFalsyHit();
        // Empty values are a subset of falsy values
        if (item.value === undefined || item.value === null || item.value === '') {
          this.hitStatistics.addEmptyHit();
        }
      }
      this.hitStatistics.addHit();
      return item.value
    }
    this.hitStatistics.addMiss();
  }
}

exports.Fifo = FifoObject;
exports.FifoMap = FifoMap;
exports.FifoObject = FifoObject;
exports.HitStatisticsRecord = HitStatisticsRecord;
exports.Lru = LruObject;
exports.LruHitStatistics = LruObjectHitStatistics;
exports.LruMap = LruMap;
exports.LruObject = LruObject;
exports.LruObjectHitStatistics = LruObjectHitStatistics;
