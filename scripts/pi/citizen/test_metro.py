import os, sys
os.environ["CITIZEN_DIR"] = "/tmp/citizen-test"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import citizen_metro as m


def v(n):
    o = b""
    while True:
        c = n & 0x7F
        n >>= 7
        o += bytes([c | (0x80 if n else 0)])
        if not n:
            return o


def ld(f, b):
    return v(f << 3 | 2) + v(len(b)) + b


def ts(text):
    return ld(1, ld(1, text.encode()))


alert = ld(1, v(1 << 3) + v(1700000000) + b"") if False else b""
alert = ld(1, v(1 << 3) + v(int(__import__("time").time()) - 60)) + ld(5, ld(2, b"720")) + ld(10, ts("720 detour on Santa Monica Blvd in West Hollywood")) + ld(11, ts("Buses use Sunset Blvd until 9 PM"))
entity = ld(1, b"alert-42") + ld(5, alert)
feed = ld(1, ld(1, b"2.0")) + ld(2, entity)
al = m.parse_alerts(feed)
assert al[0]["id"] == "alert-42" and al[0]["routes"] == ["720"], al
items = m.alerts_to_items(al, True)
assert len(items) == 1 and items[0]["ping"] is True and items[0]["category"] == "transit", items
assert m.alerts_to_items(al, False)[0]["ping"] is False
print("metro ok", items[0]["title"], "|", items[0]["sub"])
