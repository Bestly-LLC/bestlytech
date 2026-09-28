#!/usr/bin/env python3
"""Bestly Pi: answer DIRECT (unicast) mDNS queries - W3 round 4, 2026-09-28.

ROOT CAUSE it fixes: Apple devices ("unicast assist" in mDNSResponder) refresh records they already know by sending the
query straight to the host at <ip>:5353. On this Pi four mDNS stacks share port 5353 (avahi, Home Assistant zeroconf,
Homebridge ciao, hb-service). Home Assistant binds 192.168.1.211:5353 specifically, so Linux hands it every unicast
query - and it only knows its own records. Result: the Pi never answered a unicast query (not even for bestly-pi.local),
Apple devices dropped "Bestly Wall" from the AirPlay list between multicast refreshes. The HomePods answer, so they stay.

How: a socket bound to each Pi address:5353 AND to eth0 (SO_BINDTODEVICE) out-scores the others in the kernel lookup,
so unicast queries arrive here. Each query is re-asked on the LAN as a legacy multicast query from a private port; the
local stacks (avahi, HA, Homebridge) answer us directly; we pass the answers from this host back to the asker from port
5353 with normal TTLs. Multicast is untouched (all stacks still get it). Status: /run/bestly-mdns-unicast.json

Deployed at /opt/bestly/airplay/mdns_unicast.py, unit /etc/systemd/system/bestly-mdns-unicast.service (runs as root
for SO_BINDTODEVICE). Watched by /opt/bestly/wall/watchdog.py airplay_visible_watch (every 10 min, Scout key
wall.airplay_visible).
"""
import json, os, random, socket, struct, threading, time, subprocess

IFACE = "eth0"
PORT = 5353
STATUS = "/run/bestly-mdns-unicast.json"
stats = {"started": time.time(), "queries": 0, "answered": 0, "unanswered": 0, "responses_seen": 0, "addrs": [], "err": None,
         "last_answer": None}
lock = threading.Lock()


def iface_addrs():
    out = subprocess.run(["ip", "-o", "addr", "show", "dev", IFACE], capture_output=True, text=True).stdout
    v4, v6 = [], []
    for line in out.splitlines():
        p = line.split()
        if "inet" in p:
            v4.append(p[p.index("inet") + 1].split("/")[0])
        if "inet6" in p and "scope" in p and p[p.index("scope") + 1] == "global" and "temporary" not in p and "deprecated" not in p:
            v6.append(p[p.index("inet6") + 1].split("/")[0])
    return v4, v6


def rd_name(buf, off, depth=0):
    labels = []
    while True:
        l = buf[off]
        if l == 0:
            return labels, off + 1
        if l & 0xC0 == 0xC0:
            if depth > 12:
                raise ValueError("loop")
            ptr = ((l & 0x3F) << 8) | buf[off + 1]
            rest, _ = rd_name(buf, ptr, depth + 1)
            return labels + rest, off + 2
        labels.append(buf[off + 1:off + 1 + l])
        off += 1 + l


def questions(buf):
    qd = struct.unpack("!H", buf[4:6])[0]
    off, qs = 12, []
    for _ in range(min(qd, 16)):
        labels, off = rd_name(buf, off)
        qt, qc = struct.unpack("!HH", buf[off:off + 4])
        off += 4
        qs.append((labels, qt, qc & 0x7FFF))
    return qs


def fix_ttls(buf):
    """Legacy answers carry TTL 10 s; give the asker normal mDNS TTLs (PTR 75 min, others 2 min)."""
    b = bytearray(buf)
    qd, an, ns, ar = struct.unpack("!4H", b[4:12])
    off = 12
    for _ in range(qd):
        _, off = rd_name(b, off)
        off += 4
    for _ in range(an + ns + ar):
        _, off = rd_name(b, off)
        t, c, ttl, rl = struct.unpack("!HHIH", b[off:off + 10])
        if ttl > 0:
            struct.pack_into("!I", b, off + 4, 4500 if t == 12 else 120)
        off += 10 + rl
    return bytes(b)


def ask_local(qs, v4):
    """Re-ask the questions as a legacy multicast query; return answers that came from this host."""
    qid = random.randint(1, 0xFFFF)
    body = b"".join(b"".join(bytes([len(x)]) + x for x in labels) + b"\x00" + struct.pack("!HH", qt, qc) for labels, qt, qc in qs)
    pkt = struct.pack("!6H", qid, 0, len(qs), 0, 0, 0) + body
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(v4))
        s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 255)
        s.bind((v4, 0))
        s.settimeout(0.25)
        s.sendto(pkt, ("224.0.0.251", PORT))
        got, end = [], time.time() + 0.25
        while time.time() < end:
            try:
                d, a = s.recvfrom(9000)
            except socket.timeout:
                break
            if a[0] == v4 and len(d) > 12 and d[:2] == pkt[:2] and struct.unpack("!H", d[6:8])[0] > 0:
                got.append(d)
        return got
    finally:
        s.close()


def handle(sock, data, addr, v4):
    try:
        flags = struct.unpack("!H", data[2:4])[0]
        if flags & 0x8000:                          # a response sent to us (someone's QU answer): nothing to do
            with lock:
                stats["responses_seen"] += 1
            return
        qs = questions(data)
        if not qs:
            return
        with lock:
            stats["queries"] += 1
        answers = ask_local(qs, v4)
        if not answers:
            with lock:
                stats["unanswered"] += 1
            return
        for d in answers[:3]:
            out = bytearray(fix_ttls(d))
            out[0:2] = data[0:2]                      # RFC 6762 18.1: unicast reply carries the query's ID
            struct.pack_into("!H", out, 2, 0x8400)    # response + authoritative
            sock.sendto(bytes(out), addr)
        with lock:
            stats["answered"] += 1
            stats["last_answer"] = time.time()
    except Exception as e:
        with lock:
            stats["err"] = str(e)[:120]


def serve(bind_ip, v4):
    fam = socket.AF_INET6 if ":" in bind_ip else socket.AF_INET
    s = socket.socket(fam, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, IFACE.encode())
    if fam == socket.AF_INET6:
        s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
    s.bind((bind_ip, PORT))
    while True:
        data, addr = s.recvfrom(9000)
        if len(data) >= 12:
            threading.Thread(target=handle, args=(s, data, addr, v4), daemon=True).start()


def main():
    v4, v6 = iface_addrs()
    if not v4:
        raise SystemExit("no IPv4 on " + IFACE)
    stats["addrs"] = v4 + v6
    for ip in v4 + v6:
        threading.Thread(target=serve, args=(ip, v4[0]), daemon=True).start()
    while True:                                          # status file + exit if the addresses change (systemd restarts us)
        time.sleep(20)
        try:
            with open(STATUS + ".tmp", "w") as f:
                json.dump(dict(stats, at=time.time()), f)
            os.replace(STATUS + ".tmp", STATUS)
        except Exception:
            pass
        n4, n6 = iface_addrs()
        if n4 and set(n4 + n6) != set(stats["addrs"]):
            raise SystemExit("addresses changed; restarting")


if __name__ == "__main__":
    main()
