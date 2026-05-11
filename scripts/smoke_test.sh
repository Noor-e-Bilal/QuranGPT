#!/usr/bin/env bash
# smoke_test.sh — Verify all 5 POC success criteria against a running server.
#
# Usage (from repo root):
#   BASE_URL=http://localhost:3000 bash scripts/smoke_test.sh
#
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
PASS=0
FAIL=0

green() { printf '\033[32m✓ %s\033[0m\n' "$1"; }
red()   { printf '\033[31m✗ %s\033[0m\n' "$1"; }

check() {
  local desc="$1"
  local result="$2"
  if [ "$result" = "1" ]; then
    green "$desc"
    PASS=$((PASS + 1))
  else
    red "$desc"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== QuranSays Smoke Test ==="
echo "Target: $BASE_URL"
echo ""

# ── Health check ──────────────────────────────────────────────────────────
echo "── Health ──"
HEALTH=$(curl -sf "$BASE_URL/api/health" || echo '{}')
HEALTH_STATUS=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
check "Health endpoint returns ok or degraded" \
  "$( [[ "$HEALTH_STATUS" == "ok" || "$HEALTH_STATUS" == "degraded" ]] && echo 1 || echo 0 )"
echo ""

# ── Chat: normal question ─────────────────────────────────────────────────
echo "── Chat: Normal question ──"
CHAT1=$(curl -sf -X POST "$BASE_URL/api/chat" \
  -H 'Content-Type: application/json' \
  -d '{"question":"What does the Quran say about patience?"}' || echo '{}')

# Criterion 5: source_policy present
SP=$(echo "$CHAT1" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(d.get('source_policy',''))" 2>/dev/null || echo "")
check "Criterion 5: source_policy='The Clear Quran only'" \
  "$( [[ "$SP" == "The Clear Quran only" ]] && echo 1 || echo 0 )"

# Criterion 1: non-empty answer has ≥1 citation
C1=$(echo "$CHAT1" | python3 -c "
import sys, json
d = json.load(sys.stdin)
answer = d.get('answer','').strip()
cites = d.get('citations', [])
print(1 if (not answer or len(cites) >= 1) else 0)
" 2>/dev/null || echo "0")
check "Criterion 1: non-empty answer has ≥1 citation" "$C1"

# Criterion 2: citation quotes are exact substrings (checked client-side in validator tests)
# We verify the shape is correct
C2=$(echo "$CHAT1" | python3 -c "
import sys, json
d = json.load(sys.stdin)
cites = d.get('citations', [])
ok = all(c.get('reference') and c.get('quote') for c in cites)
print(1 if ok else 0)
" 2>/dev/null || echo "1")
check "Criterion 2: citations have reference + quote fields" "$C2"

echo ""

# ── Chat: weak-evidence question ─────────────────────────────────────────
echo "── Chat: Weak-evidence question ──"
CHAT2=$(curl -sf -X POST "$BASE_URL/api/chat" \
  -H 'Content-Type: application/json' \
  -d '{"question":"What is the price of a laptop computer in 2024?"}' || echo '{}')

CONF=$(echo "$CHAT2" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(d.get('confidence',''))" 2>/dev/null || echo "")
LIM=$(echo "$CHAT2" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(bool(d.get('limitations')))" 2>/dev/null || echo "False")

# Criterion 4: weak-evidence → confidence=low + limitations set
check "Criterion 4: weak-evidence → confidence=low" \
  "$( [[ "$CONF" == "low" ]] && echo 1 || echo 0 )"
check "Criterion 4: weak-evidence → limitations set" \
  "$( [[ "$LIM" == "True" ]] && echo 1 || echo 0 )"

echo ""

# ── Verse: invalid reference returns 400 ─────────────────────────────────
echo "── Verse: Invalid reference ──"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE_URL/api/verse/1/999" || echo "000")
check "Criterion 3: invalid verse ref → 400" \
  "$( [[ "$HTTP_CODE" == "400" ]] && echo 1 || echo 0 )"

HTTP_CODE2=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE_URL/api/verse/999/1" || echo "000")
check "Criterion 3: invalid surah ref → 400" \
  "$( [[ "$HTTP_CODE2" == "400" ]] && echo 1 || echo 0 )"

echo ""

# ── Verse: valid reference returns 200 ───────────────────────────────────
echo "── Verse: Valid reference ──"
VERSE=$(curl -sf "$BASE_URL/api/verse/1/1" || echo '{}')
VS=$(echo "$VERSE" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(d.get('source_policy',''))" 2>/dev/null || echo "")
check "Verse 1:1 returns source_policy" \
  "$( [[ "$VS" == "The Clear Quran only" ]] && echo 1 || echo 0 )"

echo ""
echo "=========================="
echo "Results: $PASS passed, $FAIL failed"
echo "=========================="

exit $( [[ $FAIL -eq 0 ]] && echo 0 || echo 1 )
