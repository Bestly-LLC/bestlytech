import sys
sys.path.insert(0, "/Users/jaredbest/tmp/askship")
from patchlib import patch

STATE = '''STREAM = {"player": None, "player_at": 0, "pi_at": 0, "pi_hb": None}
'''
STATE_NEW = STATE + '''
# ---------- ASKCARD_20261103: latest "Ask the wall" answer, pushed by the Mac answerer (tech.bestly.ask-wall) after it writes wall_questions; the page polls GET /api/ask ----------
ASKC_ROW = {"id": None, "question": "", "answer_text": "", "answer_card": {}, "at": 0.0}


def askc_get():
    r = dict(ASKC_ROW)
    r["age_s"] = round(time.time() - r["at"], 1) if r["at"] else None
    return r


def askc_put(b):
    if not isinstance(b, dict) or not b.get("id") or not isinstance(b.get("answer_text"), str):
        return False
    card = b.get("answer_card") if isinstance(b.get("answer_card"), dict) else {}
    ASKC_ROW.update(id=str(b["id"])[:64], question=str(b.get("question") or "")[:500], answer_text=b["answer_text"][:600],
                    answer_card=card, at=time.time())
    return True
'''

GET = '''        if p == "/api/cars":   # CARCARD_20261103
            return self.send(200, json.dumps(cars_api()))
'''
GET_NEW = GET + '''        if p == "/api/ask":   # ASKCARD_20261103
            return self.send(200, json.dumps(askc_get()))
'''

POST = '''        if p == "/api/musx/state":
            return musx_post(self)
'''
POST_NEW = '''        if p == "/api/ask":   # ASKCARD_20261103: the Mac answerer pushes the finished answer here (LAN only)
            if not lan_ok(self.client_address[0]):
                return self.send(403, '{"error":"lan only"}')
            ok = askc_put(self.body())
            return self.send(200 if ok else 400, '{"ok":true}' if ok else '{"ok":false}')
''' + POST

patch(sys.argv[1], [(STATE, STATE_NEW), (GET, GET_NEW), (POST, POST_NEW)])
