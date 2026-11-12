#!/bin/bash
# Local test data only. Never run against production.
B=${1:-http://localhost:8897}; P=${REMOTE_PIN:-123456}
case "$B" in http://localhost*|http://127.0.0.1*) ;; *) echo "Refusing to seed $B. Test data is for a local server only."; exit 1;; esac
op(){ curl -s -X POST $B/api/op -H "x-pin: $P" -H 'x-who: Test' -H 'content-type: application/json' -d "$1" >/dev/null; }
i=0; for w in funding clients funding clients network funding mentors clarity markets funding sales visibility clients partners investors confidence; do i=$((i+1)); curl -s -X POST $B/api/answer -H 'content-type: application/json' -d "{\"pid\":\"p1\",\"dev\":\"device$(printf %04d $i)x\",\"text\":\"$w\"}" >/dev/null; done
n=0; while IFS='|' read -r name co role lk of; do n=$((n+1)); curl -s -X POST $B/api/profile -H 'content-type: application/json' -d "{\"dev\":\"prof$(printf %04d $n)xx\",\"name\":\"$name\",\"company\":\"$co\",\"role\":\"$role\",\"looking\":$lk,\"offer\":$of,\"consent\":true}" >/dev/null; op "{\"action\":\"approveProfile\",\"id\":\"prof$(printf %04d $n)xx\"}"; done <<'P'
Layla Khoury|Byte Studio|Founder|["Funding","Clients"]|["Product"]
Omar Saleh|Freelance|Full Stack Developer|["Clients","Freelancing"]|["AI and Tech"]
Rana Odeh|Nablus Tech|Marketing Lead|["Partnerships"]|["Marketing","Mentoring"]
Yousef Amin|CloudBridge|CTO|["Hiring"]|["AI and Tech","Mentoring"]
Dina Haddad|Student Hub|Product Manager|["A New Job","Mentoring"]|["Product"]
Karim Nasser|Olive Labs|CEO|["Funding","Partnerships"]|["Clients"]
P
for c in "Coffee in the Main Hall" "Room A session" "Networking at lunch" "One to one corner"; do
  id=$(curl -s -X POST $B/api/photo -H 'content-type: image/jpeg' -H 'x-dev: photodev0001' -H 'x-name: Test%20Photographer' -H "x-caption: $(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$c")" --data-binary @"$(dirname "$0")/sample.jpg" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
  op "{\"action\":\"approvePhoto\",\"id\":\"$id\"}"
done
op '{"action":"way","way":{"registration":"left","rooms":"up right","oneToOnes":"right"}}'
echo seeded
