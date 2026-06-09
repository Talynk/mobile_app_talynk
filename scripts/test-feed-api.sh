#!/usr/bin/env bash
# Feed API integration test — simulates mobile app pagination logic.
set -euo pipefail

BASE="https://api.talentix.net"
EMAIL="eyochat182@gmail.com"
PASSWORD="12345678"
LIMIT=20

echo "=============================================="
echo "FEED API TEST SUITE"
echo "=============================================="

TOKEN=$(curl -sf -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"role\":\"user\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['accessToken'])")

echo "[PASS] Login OK (token ${#TOKEN} chars)"

REF=$(python3 -c "import time; print(int(time.time()*1000//60000))")
echo ""
echo "--- Primary feed (tiktok-lite) ---"

PRIMARY=$(curl -sf -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/feed/personalized?limit=$LIMIT&refresh=$REF")

python3 -c "
import json,sys
d=json.loads('''$PRIMARY''')
posts=d['data']['posts']
pag=d.get('pagination',{})
print(f'page1: {len(posts)} posts, hasNext={pag.get(\"hasNext\")}, pipeline={d[\"data\"].get(\"feed_meta\",{}).get(\"pipeline\")}')
open('/tmp/feed_test_primary_ids.txt','w').write('\n'.join(p['id'] for p in posts))
"

echo ""
echo "--- Catalog fallback (posts/all) ---"
TOTAL_UNIQUE=0
ALL_IDS_FILE="/tmp/feed_test_all_ids.txt"
> "$ALL_IDS_FILE"

for PAGE in $(seq 1 10); do
  RESP=$(curl -sf "$BASE/api/posts/all?page=$PAGE&limit=$LIMIT&featured_first=false&status=active")
  COUNT=$(echo "$RESP" | python3 -c "
import json,sys
d=json.load(sys.stdin)
posts=d['data']['posts']
pag=d['data']['pagination']
has_next=pag.get('page',0)<pag.get('totalPages',0)
print(len(posts), pag.get('total'), pag.get('totalPages'), int(has_next))
for p in posts:
    print(p['id'], file=open('/tmp/feed_page_ids.txt','a'))
")
  read -r POSTS TOTAL PAGES HAS_NEXT <<< "$COUNT"
  cat /tmp/feed_page_ids.txt >> "$ALL_IDS_FILE" 2>/dev/null || true
  rm -f /tmp/feed_page_ids.txt
  echo "  catalog page $PAGE: $POSTS posts (total=$TOTAL pages=$PAGES hasNext=$HAS_NEXT)"
  if [ "$HAS_NEXT" = "0" ]; then
    break
  fi
done

UNIQUE=$(sort -u "$ALL_IDS_FILE" | wc -l)
echo "  UNIQUE catalog posts: $UNIQUE"

echo ""
echo "--- Simulated app logic (primary exhausted -> catalog) ---"
python3 << PY
primary_has_next = $(echo "$PRIMARY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('pagination',{}).get('hasNext', False))")
primary_count = $(echo "$PRIMARY" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['data']['posts']))")
catalog_total = $UNIQUE

if not primary_has_next or primary_count < $LIMIT:
    print(f"APP WOULD: switch to catalog (primary hasNext={primary_has_next}, count={primary_count})")
    print(f"APP CAN LOAD: {catalog_total} total posts via catalog pagination")
    if catalog_total >= 100:
        print("[PASS] Infinite feed possible via catalog ($catalog_total posts)")
    else:
        print("[WARN] Catalog has only $catalog_total posts")
else:
    print("[INFO] Primary feed still has next page")
PY

echo ""
echo "--- HLS manifest check (5 random catalog videos) ---"
curl -sf "$BASE/api/posts/all?page=1&limit=5&featured_first=false&status=active" | python3 -c "
import json,sys,urllib.request
d=json.load(sys.stdin)
ok=0
fail=0
for p in d['data']['posts']:
    url=p.get('playback_url','')
    if not url or '.m3u8' not in url.lower():
        print(f'  SKIP {p[\"id\"][:8]} no hls url')
        fail+=1
        continue
    try:
        r=urllib.request.urlopen(url, timeout=10)
        body=r.read(300).decode(errors='replace')
        if '#EXTM3U' in body:
            print(f'  PASS {p[\"id\"][:8]} manifest OK ({len(body)} bytes)')
            ok+=1
        else:
            print(f'  FAIL {p[\"id\"][:8]} not m3u8')
            fail+=1
    except Exception as e:
        print(f'  FAIL {p[\"id\"][:8]} {e}')
        fail+=1
print(f'HLS: {ok} pass, {fail} fail')
"

echo ""
echo "=============================================="
echo "DONE"
echo "=============================================="
