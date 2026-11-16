#!/bin/bash
# Local test data only. Never run against production.
# The six people below are sample people with made up last 4 digits. They are test data, not registrations.
B=${1:-http://localhost:8897}; P=${REMOTE_PIN:-123456}
case "$B" in http://localhost*|http://127.0.0.1*) ;; *) echo "Refusing to seed $B. Test data is for a local server only."; exit 1;; esac
op(){ curl -s -X POST $B/api/op -H "x-pin: $P" -H 'x-who: Test' -H 'content-type: application/json' -d "$1" >/dev/null; }
# post <path> <device> <json>: prints the answer
post(){ curl -s -X POST "$B$1" -H 'content-type: application/json' -H "x-dev: $2" -d "$3"; }
js(){ python3 -c "import json,sys;d=json.load(sys.stdin);print($1)"; }
# Polls follow the schedule of the day; before the day nothing is open, so hold p1 open as the remote would.
op '{"action":"pollActivate","pid":"p1"}'
i=0; for w in funding clients funding clients network funding mentors clarity markets funding sales visibility clients partners investors confidence; do i=$((i+1)); curl -s -X POST $B/api/answer -H 'content-type: application/json' -d "{\"pid\":\"p1\",\"dev\":\"device$(printf %04d $i)x\",\"text\":\"$w\"}" >/dev/null; done

# The people list, as the remote sends it after reading the registration sheet.
op '{"action":"peopleImport","people":[
 {"name":"Layla Khoury","last4":"7391","company":"Byte Studio","title":"Founder","linkedin":"linkedin.com/in/sample-layla","topics":["Business development and international sales","AI adoption and applied AI"],"advisorPref":"remote","photoOk":true},
 {"name":"Omar Saleh","last4":"0458","company":"Freelance","title":"Full Stack Developer","topics":["Business development and international sales"],"advisorPref":"","photoOk":true},
 {"name":"Rana Odeh","last4":"6620","company":"Nablus Tech","title":"Marketing Lead","topics":["Career growth and remote work"],"advisorPref":"local","photoOk":false},
 {"name":"Yousef Amin","last4":"3187","company":"CloudBridge","title":"CTO","topics":["Engineering leadership and architecture","AI adoption and applied AI"],"advisorPref":"local","photoOk":true},
 {"name":"Dina Haddad","last4":"9045","company":"Student Hub","title":"Product Manager","topics":["Product management and strategy"],"advisorPref":"","photoOk":true},
 {"name":"Karim Nasser","last4":"5512","company":"Olive Labs","title":"CEO","topics":["Fundraising, finance, and scaling a company"],"advisorPref":"remote","photoOk":true}
]}'

# Four of them sign in during a short rehearsal at 11:50, so the day moments (hellos, takeaways) have data.
# Each has a phone: seedphone0001 to seedphone0004. Their cards go up at once (verified people).
op '{"action":"rehearsal","hhmm":"11:50"}'
n=0; while IFS='|' read -r name last4 role look offer; do n=$((n+1)); dev="seedphone000$n"
  id=$(curl -s "$B/api/who?q=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$name")" -H "x-dev: $dev" | js "d['list'][0]['id']")
  post /api/claim $dev "{\"id\":\"$id\",\"last4\":\"$last4\",\"hello\":true}" >/dev/null
  post /api/profile $dev "{\"role\":\"$role\",\"looking\":$look,\"offer\":$offer,\"consent\":true}" >/dev/null
done <<'S'
Layla Khoury|7391|Founder|["Funding","Clients"]|["Product"]
Omar Saleh|0458|Full Stack Developer|["Clients","Freelancing"]|["AI and Tech"]
Rana Odeh|6620|Marketing Lead|["Partnerships"]|["Marketing","Mentoring"]
Yousef Amin|3187|CTO|["Hiring"]|["AI and Tech","Mentoring"]
S
# Stars chosen by the person, on top of the sessions picked for them.
post /api/star seedphone0001 '{"b":1,"sid":"1A"}' >/dev/null
post /api/star seedphone0002 '{"b":1,"sid":"1C"}' >/dev/null
post /api/star seedphone0003 '{"b":3,"sid":"3C"}' >/dev/null
post /api/star seedphone0004 '{"b":2,"sid":"2A"}' >/dev/null
# Two connections: Layla and Omar, Rana and Yousef, each with the other's meet code.
code(){ curl -s $B/api/me -H "x-dev: $1" | js "d['code']"; }
post /api/meet seedphone0001 "{\"code\":\"$(code seedphone0002)\"}" >/dev/null
post /api/meet seedphone0003 "{\"code\":\"$(code seedphone0004)\"}" >/dev/null
# Three takeaways from block 1, its window is open at 11:50.
post /api/takeaway seedphone0001 '{"sid":"1A","rating":5,"text":"Lead with the client problem, not the product.","showName":true}' >/dev/null
post /api/takeaway seedphone0002 '{"sid":"1C","rating":4,"text":"Follow up within two days, always.","showName":false}' >/dev/null
post /api/takeaway seedphone0004 '{"sid":"1B","rating":5,"text":"AI changes the tasks first, then the jobs.","showName":true}' >/dev/null
op '{"action":"rehearsal","hhmm":null}'

# Two more cards from phones that never signed in, approved by the team.
n=0; while IFS='|' read -r name co role lk of; do n=$((n+1)); id=$(post /api/profile "prof$(printf %04d $n)xx" "{\"name\":\"$name\",\"company\":\"$co\",\"role\":\"$role\",\"looking\":$lk,\"offer\":$of,\"consent\":true}" | js "d['id']"); op "{\"action\":\"approveProfile\",\"id\":\"$id\"}"; done <<'P'
Dina Haddad|Student Hub|Product Manager|["A New Job","Mentoring"]|["Product"]
Karim Nasser|Olive Labs|CEO|["Funding","Partnerships"]|["Clients"]
P
for c in "Coffee in the Main Hall" "Room A session" "Networking at lunch" "One to one corner"; do
  id=$(curl -s -X POST $B/api/photo -H 'content-type: image/jpeg' -H 'x-dev: photodev0001' -H 'x-name: Test%20Photographer' -H "x-caption: $(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$c")" --data-binary @"$(dirname "$0")/sample.jpg" | js "d['id']")
  op "{\"action\":\"approvePhoto\",\"id\":\"$id\"}"
done
op '{"action":"way","way":{"roomA":"right","roomB":"left","roomC":"up","registration":"left","oneToOnes":"right"}}'
echo seeded
