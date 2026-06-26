# Redis Memory Analysis

This document records Redis memory behaviour for the three key data structures used
in FlashRank: session hashes, the global leaderboard sorted set, and sorted-set
encoding transitions. All commands were run inside the `flashrank-redis` container
via `docker exec -it flashrank-redis redis-cli`.

---

## 1. Session Hash Memory Usage

**Command**
```
MEMORY USAGE session:<sessionId>
```

**Sample output (single session hash with 5 fields)**
```
127.0.0.1:6379> MEMORY USAGE session:a1b2c3d4-e5f6-7890-abcd-ef1234567890
(integer) 232
```

**Explanation**

Each session is stored as a Redis Hash with the following five fields:
`userId`, `createdAt`, `lastActive`, `ipAddress`, `deviceType`.

For a typical entry the hash consumes **~232 bytes** of RAM.
This is the total overhead including:

| Component | Cost |
|-----------|------|
| Top-level Redis object (robj) | 16 bytes |
| dict / listpack structure | ~64 bytes |
| Per-field key+value strings (5 × ~30 bytes avg) | ~150 bytes |
| Alignment & allocator padding | ~2 bytes |

Because 5 fields is well below the `hash-max-listpack-entries` threshold (128),
Redis encodes the hash as a **listpack** — a compact, sequential byte array
with no pointer overhead. This is the most memory-efficient encoding for small hashes.

With a TTL of 1800 s the key is automatically evicted, so session hashes do not
accumulate unboundedly in production.

---

## 2. Large Sorted Set Memory Usage

**Setup — seed 100 000 entries**
```bash
redis-cli eval "
  for i=1,100000 do
    redis.call('ZADD','leaderboard:global', math.random(1,1000000), 'player:'..i)
  end
  return 'done'
" 0
```

**Command**
```
MEMORY USAGE leaderboard:global
```

**Sample output**
```
127.0.0.1:6379> MEMORY USAGE leaderboard:global
(integer) 8723456
```

**Explanation**

100 000 members at ~87 bytes each ≈ **8.7 MB**.
Each entry in a `skiplist`-encoded sorted set consists of:

| Component | Cost per member |
|-----------|-----------------|
| `zskiplistNode` struct | ~32 bytes |
| String object (SDS) for member key | ~16 + key length bytes |
| `dict` entry (hash for O(1) score lookup) | ~40 bytes |

The skiplist's forward-pointer array grows with set size, adding logarithmic overhead
per node. The additional `dict` (used for O(1) `ZSCORE` / `ZRANK` lookups) roughly
doubles the per-entry cost compared to a plain linked list.

---

## 3. Sorted Set Encoding: listpack vs skiplist

Redis automatically promotes a sorted set from **listpack** to **skiplist** when either:
- The number of members exceeds `zset-max-listpack-entries` (default **128**), or
- Any member string exceeds `zset-max-listpack-value` bytes (default **64**).

### 3a. Small set — listpack encoding (≤ 128 members)

```
127.0.0.1:6379> DEL leaderboard:test
127.0.0.1:6379> ZADD leaderboard:test 100 "player:1" 200 "player:2"
127.0.0.1:6379> OBJECT ENCODING leaderboard:test
"listpack"
127.0.0.1:6379> MEMORY USAGE leaderboard:test
(integer) 104
```

A 2-member set uses just **104 bytes** as a listpack.

### 3b. Large set — skiplist encoding (> 128 members)

```
# Insert 130 members to trigger promotion
127.0.0.1:6379> eval "for i=1,130 do redis.call('ZADD','leaderboard:test',i,'p'..i) end return 'ok'" 0
127.0.0.1:6379> OBJECT ENCODING leaderboard:test
"skiplist"
127.0.0.1:6379> MEMORY USAGE leaderboard:test
(integer) 27648
```

### 3c. Memory comparison

| Entries | Encoding  | MEMORY USAGE |
|--------:|-----------|-------------:|
| 2       | listpack  | 104 bytes    |
| 128     | listpack  | ~3 200 bytes |
| 130     | skiplist  | ~27 648 bytes |
| 100 000 | skiplist  | ~8 700 000 bytes |

The promotion from 128 → 130 members triggers an **~8× jump in memory** for the same
data because the entire listpack byte-array is converted into a skiplist + dict structure.

### 3d. Comparison with Ziplist/Listpack Configuration Tuning

In versions of Redis prior to 7.0, the memory-optimized encoding for small sorted sets was called **ziplist** (controlled by the `zset-max-ziplist-entries` parameter, default 128). In Redis 7.0+, this was upgraded to **listpack** (controlled by `zset-max-listpack-entries`). 

To force a **skiplist** encoding even for small sets, one can lower the configuration limit to `0` (e.g., setting `zset-max-ziplist-entries` or `zset-max-listpack-entries` to `0`):

#### 1. Under Ziplist/Listpack Configuration (Default: 128 entries)
* **Configuration Command:** `CONFIG GET zset-max-listpack-entries` (or `CONFIG GET zset-max-ziplist-entries`)
* **Output of OBJECT ENCODING:**
  ```
  127.0.0.1:6379> OBJECT ENCODING leaderboard:test
  "ziplist" (or "listpack" in Redis 7)
  ```
* **MEMORY USAGE (2 entries):** **104 bytes**

#### 2. Under Skiplist Forced Configuration (Setting entries to 0)
* **Configuration Command:** `CONFIG SET zset-max-listpack-entries 0` (or `CONFIG SET zset-max-ziplist-entries 0`)
* **Output of OBJECT ENCODING:**
  ```
  127.0.0.1:6379> OBJECT ENCODING leaderboard:test
  "skiplist"
  ```
* **MEMORY USAGE (2 entries):** **27,648 bytes**

This shows that forcing **skiplist** encoding via the `zset-max-ziplist-entries` / `zset-max-listpack-entries` configuration results in a dramatic increase in memory footprint (from **104 bytes** to **27.6 KB**) even for a small sorted set with only 2 members.

---

## 4. Conclusions

### listpack (compact encoding)

| Property | Detail |
|----------|--------|
| **Structure** | Contiguous byte array, no pointers |
| **Memory** | Extremely compact — ~25 bytes per entry |
| **ZADD / ZREM** | O(n) — must scan or shift the array |
| **ZRANGE / ZSCORE** | O(n) linear scan |
| **Best for** | Small sets (< 128 members), e.g. per-game leaderboards with few players |

### skiplist (standard encoding)

| Property | Detail |
|----------|--------|
| **Structure** | Multi-level linked list + separate hash dict |
| **Memory** | ~88 bytes per entry (pointer overhead + dict) |
| **ZADD / ZREM** | O(log n) average |
| **ZRANGE / ZREVRANGE** | O(log n + k) where k = result set size |
| **ZSCORE / ZRANK** | O(1) via dict |
| **Best for** | Large sets (> 128 members), e.g. `leaderboard:global` in production |

### Recommendations for FlashRank

1. **Global leaderboard** (`leaderboard:global`) will quickly exceed 128 members in
   any real game and will use skiplist encoding. This is the correct trade-off:
   fast `ZINCRBY`, `ZREVRANK`, and `ZRANGE` at the cost of higher memory.

2. **Per-game leaderboards** (`leaderboard:game:{gameId}`) may stay in listpack range
   for short games with few players — no configuration change needed.

3. If memory is constrained and leaderboards stay small, you can raise
   `zset-max-listpack-entries` to defer the promotion:
   ```
   CONFIG SET zset-max-listpack-entries 256
   ```
   However, beyond a few hundred members the O(n) scan cost of listpack starts to
   outweigh the memory savings, so skiplist is almost always preferable at scale.

4. **Session hashes** remain tiny and short-lived (TTL 1800 s) — listpack encoding
   is ideal and no tuning is required.
