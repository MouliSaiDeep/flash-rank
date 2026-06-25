#!/bin/sh
# FlashRank In-Container Verification Script
# Run: docker exec flashrank-api sh /tmp/verify.sh
BASE="http://localhost:3000"
PASS=0; FAIL=0

ok()  { echo "✅ $1"; PASS=$((PASS+1)); }
fail(){ echo "❌ $1 — got: $2"; FAIL=$((FAIL+1)); }
chk() { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1" "$2 (expected $3)"; fi; }

echo "======= FlashRank Verification ======="

# Flush Redis database to ensure clean, repeatable runs
redis-cli -h redis flushdb >/dev/null 2>&1

# --- CHECK 3: GET /health ---
R=$(curl -s -o /dev/null -w "%{http_code}" $BASE/health)
chk "GET /health → 200" "$R" "200"
B=$(curl -s $BASE/health)
echo "  body: $B"

# --- CHECK 5: POST /api/sessions ---
S1=$(curl -s -X POST $BASE/api/sessions -H "Content-Type: application/json" \
  -d '{"userId":"u1","ipAddress":"1.1.1.1","deviceType":"desktop"}')
SID1=$(echo $S1 | sed 's/.*"sessionId":"\([^"]*\)".*/\1/')
[ -n "$SID1" ] && ok "POST /api/sessions → sessionId returned" || fail "POST /api/sessions" "$S1" "sessionId"
echo "  sid1=$SID1"

S2=$(curl -s -X POST $BASE/api/sessions -H "Content-Type: application/json" \
  -d '{"userId":"u1","ipAddress":"2.2.2.2","deviceType":"mobile"}')
SID2=$(echo $S2 | sed 's/.*"sessionId":"\([^"]*\)".*/\1/')
echo "  sid2=$SID2"

# --- CHECK 6: 3rd session deletes previous 2 ---
S3=$(curl -s -X POST $BASE/api/sessions -H "Content-Type: application/json" \
  -d '{"userId":"u1","ipAddress":"3.3.3.3","deviceType":"tablet"}')
SID3=$(echo $S3 | sed 's/.*"sessionId":"\([^"]*\)".*/\1/')
echo "  sid3=$SID3"

TTL=$(redis-cli -h redis TTL "session:$SID3" 2>/dev/null || echo "N/A")
[ "$TTL" -gt 1700 ] 2>/dev/null && ok "New session TTL > 1700 ($TTL)" || fail "New session TTL" "$TTL" ">1700"

OLD1=$(redis-cli -h redis EXISTS "session:$SID1" 2>/dev/null || echo "N/A")
chk "Old session1 deleted (Lua)" "$OLD1" "0"

OLD2=$(redis-cli -h redis EXISTS "session:$SID2" 2>/dev/null || echo "N/A")
chk "Old session2 deleted (Lua)" "$OLD2" "0"

# --- CHECK 7: Leaderboard ZINCRBY atomically ---
SC1=$(curl -s -X POST $BASE/api/leaderboard/scores -H "Content-Type: application/json" \
  -d '{"playerId":"alice","points":100}')
NS1=$(echo $SC1 | sed 's/.*"newScore":\([0-9.]*\).*/\1/')
chk "Alice score call1=100" "$NS1" "100"

SC2=$(curl -s -X POST $BASE/api/leaderboard/scores -H "Content-Type: application/json" \
  -d '{"playerId":"alice","points":50}')
NS2=$(echo $SC2 | sed 's/.*"newScore":\([0-9.]*\).*/\1/')
chk "Alice score call2=150 (accumulated)" "$NS2" "150"

curl -s -X POST $BASE/api/leaderboard/scores -H "Content-Type: application/json" -d '{"playerId":"bob","points":200}' >/dev/null
curl -s -X POST $BASE/api/leaderboard/scores -H "Content-Type: application/json" -d '{"playerId":"charlie","points":75}' >/dev/null
curl -s -X POST $BASE/api/leaderboard/scores -H "Content-Type: application/json" -d '{"playerId":"diana","points":180}' >/dev/null
curl -s -X POST $BASE/api/leaderboard/scores -H "Content-Type: application/json" -d '{"playerId":"eve","points":120}' >/dev/null
curl -s -X POST $BASE/api/leaderboard/scores -H "Content-Type: application/json" -d '{"playerId":"frank","points":90}' >/dev/null

# --- CHECK 8: GET /api/leaderboard/top/5 ---
TOP=$(curl -s "$BASE/api/leaderboard/top/5")
echo "  top5: $TOP" | head -c 200; echo
TOP1=$(echo $TOP | sed 's/.*"playerId":"\([^"]*\)".*/\1/' | cut -d'"' -f1)
T1=$(echo $TOP | grep -o '"rank":1' | head -1)
[ "$T1" = '"rank":1' ] && ok "GET /api/leaderboard/top/5 has rank:1" || fail "top/5 rank:1 missing" "$TOP" "rank:1"
TCODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/leaderboard/top/5")
chk "GET /api/leaderboard/top/5 → 200" "$TCODE" "200"

# --- CHECK 9: Player stats with rank/percentile/nearby ---
PCODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/leaderboard/player/alice")
chk "GET /api/leaderboard/player/alice → 200" "$PCODE" "200"
PSTAT=$(curl -s "$BASE/api/leaderboard/player/alice")
echo "  playerStat: $(echo $PSTAT | head -c 300)"
PRANK=$(echo $PSTAT | grep -o '"rank":[0-9]*' | head -1 | cut -d: -f2)
[ -n "$PRANK" ] && ok "alice rank present ($PRANK)" || fail "alice rank missing" "$PSTAT" "rank"
PPCT=$(echo $PSTAT | grep -o '"percentile":[0-9.]*' | cut -d: -f2)
[ -n "$PPCT" ] && ok "alice percentile present ($PPCT)" || fail "alice percentile missing" "$PSTAT" "percentile"
PNEAR=$(echo $PSTAT | grep -o '"nearbyPlayers"')
[ "$PNEAR" = '"nearbyPlayers"' ] && ok "nearbyPlayers present" || fail "nearbyPlayers missing" "$PSTAT" "nearbyPlayers"

# --- CHECK 10: Seed game round ---
RND=$(curl -s -w "\n%{http_code}" -X POST $BASE/api/game/rounds -H "Content-Type: application/json" \
  -d '{"gameId":"g1","roundId":"r1","correctAnswer":"Paris","points":50,"durationMs":60000}')
RCODE=$(echo "$RND" | tail -1)
chk "POST /api/game/rounds → 201" "$RCODE" "201"

# --- CHECK 10: Submit correct answer → SUCCESS ---
SUB1_RAW=$(curl -s -w "\n%{http_code}" -X POST $BASE/api/game/submit -H "Content-Type: application/json" \
  -d '{"gameId":"g1","roundId":"r1","playerId":"alice","answer":"Paris"}')
SUB1_CODE=$(echo "$SUB1_RAW" | tail -1)
SUB1_BODY=$(echo "$SUB1_RAW" | head -1)
SUB1_STAT=$(echo $SUB1_BODY | grep -o '"status":"SUCCESS"')
chk "POST /api/game/submit → 200" "$SUB1_CODE" "200"
[ "$SUB1_STAT" = '"status":"SUCCESS"' ] && ok "First submit status=SUCCESS" || fail "First submit not SUCCESS" "$SUB1_BODY" "SUCCESS"

# --- CHECK 11: Duplicate submit → 400 DUPLICATE_SUBMISSION ---
SUB2_RAW=$(curl -s -w "\n%{http_code}" -X POST $BASE/api/game/submit -H "Content-Type: application/json" \
  -d '{"gameId":"g1","roundId":"r1","playerId":"alice","answer":"Paris"}')
SUB2_CODE=$(echo "$SUB2_RAW" | tail -1)
SUB2_BODY=$(echo "$SUB2_RAW" | head -1)
chk "Duplicate submit → 400" "$SUB2_CODE" "400"
DUP=$(echo $SUB2_BODY | grep -o '"code":"DUPLICATE_SUBMISSION"')
[ "$DUP" = '"code":"DUPLICATE_SUBMISSION"' ] && ok "code=DUPLICATE_SUBMISSION" || fail "code not DUPLICATE_SUBMISSION" "$SUB2_BODY" "DUPLICATE_SUBMISSION"

# --- CHECK 12: Expired round → 403 ROUND_EXPIRED ---
curl -s -X POST $BASE/api/game/rounds -H "Content-Type: application/json" \
  -d '{"gameId":"g1","roundId":"r99","correctAnswer":"X","points":10,"durationMs":1}' >/dev/null
sleep 1
SUB3_RAW=$(curl -s -w "\n%{http_code}" -X POST $BASE/api/game/submit -H "Content-Type: application/json" \
  -d '{"gameId":"g1","roundId":"r99","playerId":"bob","answer":"X"}')
SUB3_CODE=$(echo "$SUB3_RAW" | tail -1)
SUB3_BODY=$(echo "$SUB3_RAW" | head -1)
chk "Expired round → 403" "$SUB3_CODE" "403"
EXP=$(echo $SUB3_BODY | grep -o '"code":"ROUND_EXPIRED"')
[ "$EXP" = '"code":"ROUND_EXPIRED"' ] && ok "code=ROUND_EXPIRED" || fail "code not ROUND_EXPIRED" "$SUB3_BODY" "ROUND_EXPIRED"

# --- CHECK 13: SSE publish on score update ---
SSEC=$(curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/api/leaderboard/scores -H "Content-Type: application/json" \
  -d '{"playerId":"sse-tester","points":999}')
chk "Score update published (SSE) → 200" "$SSEC" "200"

# --- CHECK 14-15: Admin sessions ---
ASESS=$(curl -s -X POST $BASE/api/sessions -H "Content-Type: application/json" \
  -d '{"userId":"adm","ipAddress":"9.9.9.9","deviceType":"desktop"}')
ASID=$(echo $ASESS | sed 's/.*"sessionId":"\([^"]*\)".*/\1/')
echo "  admin sessionId=$ASID"

LCODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/admin/sessions/user/adm")
chk "GET /api/admin/sessions/user/:id → 200" "$LCODE" "200"
LBODY=$(curl -s "$BASE/api/admin/sessions/user/adm")
LCNT=$(echo $LBODY | grep -o '"sessionId"' | wc -l | tr -d ' ')
[ "$LCNT" -ge 1 ] && ok "Admin lists ≥1 session ($LCNT)" || fail "Admin session list empty" "$LBODY" "sessionId"

DCODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/admin/sessions/$ASID")
chk "DELETE /api/admin/sessions/:id → 204" "$DCODE" "204"
GONE=$(redis-cli -h redis EXISTS "session:$ASID" 2>/dev/null || echo "N/A")
chk "Session key removed from Redis" "$GONE" "0"

echo ""
echo "======= RESULTS: $PASS passed / $FAIL failed ======="
[ $FAIL -eq 0 ] && exit 0 || exit 1
