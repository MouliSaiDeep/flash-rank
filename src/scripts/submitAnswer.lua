-- KEYS[1] = game_round:{gameId}:{roundId}   (Hash with endTime, correctAnswer, points)
-- KEYS[2] = submissions:{gameId}:{roundId}  (Set of playerIds who submitted)
-- KEYS[3] = leaderboard:global              (Sorted Set)
-- ARGV[1] = playerId
-- ARGV[2] = answer (submitted by player)
-- ARGV[3] = currentTime (Unix timestamp in ms, passed from Node.js)
--
-- Returns:
--   {1,  "<newScore>"}   — success, player scored
--   {-1, "ROUND_EXPIRED"}      — round does not exist or has ended
--   {-2, "DUPLICATE_SUBMISSION"} — player already submitted this round

local roundKey       = KEYS[1]
local submissionsKey = KEYS[2]
local leaderboardKey = KEYS[3]
local playerId       = ARGV[1]
local answer         = ARGV[2]
local currentTime    = tonumber(ARGV[3])

-- Check 1: Does the round exist and is it still active?
local endTime = tonumber(redis.call('HGET', roundKey, 'endTime'))
if not endTime or currentTime > endTime then
    return {-1, 'ROUND_EXPIRED'}
end

-- Check 2: Has the player already submitted for this round?
local alreadySubmitted = redis.call('SISMEMBER', submissionsKey, playerId)
if alreadySubmitted == 1 then
    return {-2, 'DUPLICATE_SUBMISSION'}
end

-- All checks passed: record the submission
redis.call('SADD', submissionsKey, playerId)

-- Determine points to award
local correctAnswer  = redis.call('HGET', roundKey, 'correctAnswer')
local pointsToAward  = 0

if answer == correctAnswer then
    pointsToAward = tonumber(redis.call('HGET', roundKey, 'points')) or 10
end

-- Atomically increment the player's score on the global leaderboard
local newScore = redis.call('ZINCRBY', leaderboardKey, pointsToAward, playerId)

return {1, tostring(newScore)}
