import { chromium } from "playwright";
const shots = JSON.parse(process.argv[2]);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1200, height: 1200 } });
for (const s of shots) {
  await p.goto(`http://127.0.0.1:8765/device.html?${s.q}`);
  await p.waitForFunction(() => window.DONE || window.ERR, null, { timeout: 120000 });
  const err = await p.evaluate(() => window.ERR); if (err) { console.log("ERR", err); continue; }
  const data = await p.evaluate(() => document.querySelector("canvas").toDataURL("image/png"));
  (await import("fs")).writeFileSync(s.out, Buffer.from(data.split(",")[1], "base64"));
  console.log("ok", s.out, await p.evaluate(() => window.NAMES.join(",")));
}
await b.close();
