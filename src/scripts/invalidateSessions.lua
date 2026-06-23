-- KEYS[1] = user_sessions:{userId}
-- ARGV[1] = newSessionId
-- ARGV[2] = sessionKey (e.g. "session:{newSessionId}")
-- ARGV[3] = TTL in seconds
-- ARGV[4] = userId
-- ARGV[5] = createdAt
-- ARGV[6] = lastActive
-- ARGV[7] = ipAddress
-- ARGV[8] = deviceType
--
-- Atomically invalidates all existing sessions for a user, registers the new session ID
-- in the user's session set, creates the new session hash, and sets its TTL.
-- Returns the number of sessions that were invalidated.

local sessionSetKey = KEYS[1]
local newSessionId = ARGV[1]
local sessionKey = ARGV[2]
local ttl = tonumber(ARGV[3])
local userId = ARGV[4]
local createdAt = ARGV[5]
local lastActive = ARGV[6]
local ipAddress = ARGV[7]
local deviceType = ARGV[8]

-- Get all existing session IDs for this user
local existingIds = redis.call('SMEMBERS', sessionSetKey)

-- Delete each existing session hash
for _, sessionId in ipairs(existingIds) do
    redis.call('DEL', 'session:' .. sessionId)
end

-- Clear the set and add only the new session ID
redis.call('DEL', sessionSetKey)
redis.call('SADD', sessionSetKey, newSessionId)

-- Store the new session hash
redis.call('HSET', sessionKey,
    'userId', userId,
    'createdAt', createdAt,
    'lastActive', lastActive,
    'ipAddress', ipAddress,
    'deviceType', deviceType
)

-- Set TTL on the session hash
redis.call('EXPIRE', sessionKey, ttl)

return existingIds
