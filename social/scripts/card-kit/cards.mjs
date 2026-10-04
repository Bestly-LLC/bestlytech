import { chromium } from "playwright";
import fs from "fs";
const items = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1080, height: 1080 } });
for (const it of items) {
  await p.goto("about:blank"); await p.goto("http://127.0.0.1:8765/card.html?n=" + Math.random() + "#" + encodeURIComponent(JSON.stringify(it)));
  await p.waitForFunction(() => window.DONE);
  await p.waitForTimeout(150);
  const over = await p.evaluate(() => { const t = document.querySelector('.txt').getBoundingClientRect(); return Math.round(t.bottom); });
  await p.screenshot({ path: it.out, type: "png" });
  console.log("ok", it.out, "text bottom", over);
}
await b.close();
