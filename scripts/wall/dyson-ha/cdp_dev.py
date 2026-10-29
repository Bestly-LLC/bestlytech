
import json, socket, base64, os, struct, time, urllib.request
tabs = json.load(urllib.request.urlopen("http://127.0.0.1:47333/json", timeout=5))
tab = next(t for t in tabs if t.get("type") == "page" and t.get("title","") == "Bestly Wall")
u = tab["webSocketDebuggerUrl"].split("//",1)[1]; hostport, path = u.split("/",1); host, port = hostport.split(":")
s = socket.create_connection((host, int(port)), timeout=20)
k = base64.b64encode(os.urandom(16)).decode()
s.send(f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {k}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
buf = b""
while b"\r\n\r\n" not in buf: buf += s.recv(4096)
rest = buf.split(b"\r\n\r\n",1)[1]
def send(o):
    d = json.dumps(o).encode(); m = os.urandom(4); h = bytes([0x81])
    h += bytes([0x80|len(d)]) if len(d) < 126 else bytes([0xFE]) + struct.pack(">H", len(d))
    s.send(h + m + bytes(b ^ m[i % 4] for i, b in enumerate(d)))
def recv():
    global rest
    def need(n):
        global rest
        while len(rest) < n: rest += s.recv(65536)
        out, rest = rest[:n], rest[n:]; return out
    b1, b2 = need(2); ln = b2 & 0x7F
    if ln == 126: ln = struct.unpack(">H", need(2))[0]
    elif ln == 127: ln = struct.unpack(">Q", need(8))[0]
    return json.loads(need(ln))
mid = [0]
def call(method, params=None):
    mid[0] += 1; send({"id": mid[0], "method": method, "params": params or {}})
    while True:
        r = recv()
        if r.get("id") == mid[0]: return r
def ev(expr): return call("Runtime.evaluate", {"expression": expr, "returnByValue": True}).get("result", {}).get("result", {}).get("value")
call("Page.reload", {"ignoreCache": True}); print("wall reloaded", time.strftime("%I:%M:%S %p"))
time.sleep(20)
print("devices card:", json.dumps(ev("(()=>{const a=document.querySelector('#cDev');return a?a.innerText.replace(/\\s+/g,' ').trim():'card not in rotation right now'})()")))
print("devErr:", ev("(window.DEV&&DEV.err)||'none'"))
