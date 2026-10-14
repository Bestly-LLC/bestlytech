import { open, shot, openBoardAsStaff } from "./lib.mjs";
const { browser, page } = await open({ slug: "centering-you", size: "390" });
const { page: b, log } = await openBoardAsStaff(page);
await shot(b, "board-1");
console.log((await b.evaluate(() => location.pathname + " " + (location.search ? "?…" : "") + " viewer=" + (typeof BOARD !== "undefined" && BOARD && BOARD.viewer ? JSON.stringify(BOARD.viewer).slice(0, 80) : "n/a") + " token=" + (typeof TOKEN === "string" ? TOKEN.slice(0, 3) : "?"))));
console.log((await b.evaluate(() => document.body.innerText.slice(0, 200))).replace(/\n+/g, " | "));
console.log(JSON.stringify(log));
await browser.close();
