// 2x JPEG of the live wall (Mac headless Chrome copy = what the projector shows) -> argv[2]
import fs from "node:fs";
const list = await (await fetch("http://127.0.0.1:47333/json/list")).json();
const pg = list.find((t) => t.type === "page" && t.url.includes(":18099/"));
const ws = new WebSocket(pg.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const call = (method, params) => new Promise((ok) => { const i = ++id; ws.addEventListener("message", function h(e) { const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener("message", h); ok(m.result); } }); ws.send(JSON.stringify({ id: i, method, params })); });
const r = await call("Page.captureScreenshot", { format: "jpeg", quality: 88, clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 2 } });
fs.writeFileSync(process.argv[2], Buffer.from(r.data, "base64"));
ws.close();
console.log("saved", process.argv[2]);
