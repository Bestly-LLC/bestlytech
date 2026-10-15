// Pre-flight: load the pages Google reviewers will open; print title, YouTube mentions, footer links.
const { chromium } = require("playwright");
const OUT = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  for (const [n, u] of [["home","https://www.bestly.tech/"],["privacy","https://www.bestly.tech/privacy"],["privacy-policy","https://www.bestly.tech/privacy-policy"],["terms","https://www.bestly.tech/terms"],["connect","https://www.bestly.tech/connect/youtube.html"]]) {
    await p.goto(u, { waitUntil: "networkidle" }); await p.waitForTimeout(800);
    const info = await p.evaluate(() => ({ title: document.title, h1: (document.querySelector("h1")||{}).innerText, yt: /youtube/i.test(document.body.innerText), lim: /limited use/i.test(document.body.innerText),
      links: [...document.querySelectorAll("a")].map(a=>a.getAttribute("href")).filter(h=>h&&/privacy|terms/i.test(h)).slice(0,8) }));
    console.log(n, JSON.stringify(info));
    await p.screenshot({ path: `${OUT}/${n}.png` });
  }
  await b.close();
})();
