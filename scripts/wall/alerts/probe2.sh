python3 - <<'EOF'
import json,urllib.request,urllib.parse
tok=[l.split("=",1)[1].strip().strip("\"'") for l in open("/home/pi/scripts/.env") if l.startswith("HA_TOKEN=")][0]
def get(p):
    r=urllib.request.Request("http://127.0.0.1:8123/api/"+p,headers={"Authorization":"Bearer "+tok})
    return json.load(urllib.request.urlopen(r,timeout=30))
s="2026-11-03T03:56:10+00:00"; e="2026-11-03T03:56:40+00:00"
d=get("logbook/"+urllib.parse.quote(s)+"?end_time="+urllib.parse.quote(e))
print(len(d))
for x in d:
    print(json.dumps({k:v for k,v in x.items() if v is not None and k not in ("icon",)})[:330])
EOF
