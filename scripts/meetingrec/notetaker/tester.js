// tester.js — a fake guest for testing the notetaker. Joins a public Talk room
// as a guest with Chrome's fake microphone (a beep) and stays for N seconds.
// usage: node tester.js <roomToken> <name> <seconds>
const { chromium } = require("playwright-core");
const [token, name, secs, audio] = process.argv.slice(2);
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
(async () => {
  const b = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", ...(audio ? [`--use-file-for-fake-audio-capture=${audio}`] : [])],
  });
  const ctx = await b.newContext({ userAgent: UA, permissions: ["microphone"] });
  const page = await ctx.newPage();
  await page.goto(`https://cloud.bestly.tech/call/${token}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const nameBox = page.getByPlaceholder(/display name|guest/i).first();
  if (!(await nameBox.count())) {
    await page.locator("button.join-call").first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
  await page.getByPlaceholder(/display name|guest/i).first().fill(name);
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /join call|start call|submit name and join/i }).last().click();
  await page.waitForTimeout(4000);
  // No call yet: start it; then confirm in the device dialog if it shows.
  for (let i = 0; i < 2; i++) {
    const jc = page.locator("button.join-call").first();
    if (await jc.count() && await jc.isVisible()) { await jc.click().catch(() => {}); await page.waitForTimeout(2500); }
    const dlg = page.locator(".modal-container").getByRole("button", { name: /join call|start call/i });
    if (await dlg.count()) { await dlg.last().click().catch(() => {}); await page.waitForTimeout(2500); }
  }
  await page.screenshot({ path: __dirname + "/shots/tester.png" });
  console.log("tester in call as", name);
  await page.waitForTimeout(Number(secs || 60) * 1000);
  await b.close();
  console.log("tester left");
})().catch((e) => { console.error("tester error", e.message); process.exit(1); });
