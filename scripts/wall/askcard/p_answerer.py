import sys
sys.path.insert(0, "/Users/jaredbest/tmp/askship")
from patchlib import patch

A1 = '''        if want and L.get("line") != want:
            continue
'''
A1N = A1 + '''        if L.get("line") == "105" and not re.search(r"LAX", " ".join(str(L.get(k) or "") for k in ("toward", "direction", "headsign")), re.I):
            continue    # ASKCARD: same as the wall bus card, only the 105 toward LAX
'''
A2 = '''    toward = (L.get("headsign") or L.get("direction") or "").strip()
'''
A2N = '''    # ASKCARD: same short form the wall bus card uses (105 -> LAX, "Toward " dropped, "trips" dropped)
    toward = re.sub(r"\\s+trips$", "", re.sub(r"^toward\\s+", "", (L.get("toward") or "").strip(), flags=re.I), flags=re.I).strip()
    if L.get("line") == "105" and re.search(r"LAX", " ".join(str(L.get(k) or "") for k in ("toward", "direction", "headsign")), re.I):
        toward = "LAX"
    if not toward:
        toward = (L.get("headsign") or L.get("direction") or "").strip()
'''
A3 = '''def handle(row):
'''
A3N = '''def askc_push(row, say, card):
    """ASKCARD: hand the finished answer to the wall (Hestia /api/ask) so the answer card shows it. Best effort, never blocks the answer."""
    try:
        http_json(WALL + "/api/ask", {"id": row["id"], "question": row["question"], "answer_text": say, "answer_card": card}, timeout=3)
    except Exception as e:
        log("askc push failed", repr(e)[:100])


''' + A3
A4 = '''        rpc("wall_ask_answer_t", {"p_token": TOKEN, "p_id": row["id"], "p_text": say, "p_card": card, "p_method": method})
'''
A4N = A4 + '''        askc_push(row, say, card)
'''
patch(sys.argv[1], [(A1, A1N), (A2, A2N), (A3, A3N), (A4, A4N)])
