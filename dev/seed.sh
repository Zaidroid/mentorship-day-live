#!/bin/bash
# Local test data only. Never run against production.
B=${1:-http://localhost:8899}; P=123456
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
for f in /tmp/claude-0/-home-claude/b1155bc3-6993-516a-859f-ef808fa1822c/scratchpad/print/assets/p_rania.jpg /tmp/claude-0/-home-claude/b1155bc3-6993-516a-859f-ef808fa1822c/scratchpad/print/preview/roomB.png /tmp/claude-0/-home-claude/b1155bc3-6993-516a-859f-ef808fa1822c/scratchpad/print/assets/p_iyas.jpg /tmp/claude-0/-home-claude/b1155bc3-6993-516a-859f-ef808fa1822c/scratchpad/out/Mentorship_Day_2026_Agenda_Page-1.png /tmp/claude-0/-home-claude/b1155bc3-6993-516a-859f-ef808fa1822c/scratchpad/print/preview/wall_half.png; do
  python3 -c "from PIL import Image;import sys;im=Image.open(sys.argv[1]).convert('RGB');im.thumbnail((1600,1600));im.save('/tmp/seed.jpg',quality=85)" "$f"
  id=$(curl -s -X POST $B/api/photo -H 'content-type: image/jpeg' -H 'x-dev: photodev0001' -H 'x-name: Test%20Photographer' -H 'x-caption: Mentorship%20Day%20moment' --data-binary @/tmp/seed.jpg | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
  op "{\"action\":\"approvePhoto\",\"id\":\"$id\"}"
done
op '{"action":"way","way":{"registration":"left","rooms":"up right","oneToOnes":"right"}}'
echo seeded
