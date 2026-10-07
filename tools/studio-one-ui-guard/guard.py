#!/usr/bin/env python3
"""Studio one-UI guard (browser half). Owner: Studio Watch.

Loads one HOKU post and one Centering YOU post in staff Studio and fails when their layout markers differ.
The database half (studio_one_ui_check, daily 4:17 AM PT) reads the live app's code; this one runs the page.

  STUDIO_STAFF_TOKEN=<a staff session token>  python3 guard.py [--preview <build id>]

The token is read from the environment only; it is never printed or stored. Read-only: it never presses anything
that writes. Exit 0 = same layout, 1 = differs or a page error, 2 = could not run. On failure it prints one line
per problem; Studio Watch's scheduler forwards that to Scout with scout_notify (signed "Studio Watch:").
Needs: pip install playwright && playwright install chromium; HTTPS_PROXY is honoured if set.
"""
import asyncio, os, sys, json
from playwright.async_api import async_playwright

BASE = "https://studio.bestly.tech"
PAIR = ("centering-you", "hoku")
MARK = """()=>{const q=s=>document.querySelectorAll(s).length;
 return {lhead:q('#list .lhead'), stage:q('#list .stage')>=4, row:q('#list .row')>0, h1:q('#detail h1'),
  decide:q('#detail .panel.decide'), dsec:q('#detail .panel.decide .dsec'), notes:q('#detail .panel')>0,
  q3:document.getElementById('app').classList.contains('q3'), second_layout:q('.hrow')}}"""

async def load(ctx, slug, token, preview):
    pg = await ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    await pg.add_init_script(f"try{{localStorage.setItem('bestly.studio.session','{token}');localStorage.setItem('bestly.studio.client','{slug}');}}catch(e){{}}")
    await pg.goto(BASE + "/" + (f"?preview={preview}" if preview else "") + "#queue", wait_until="domcontentloaded")
    for _ in range(60):
        await pg.wait_for_timeout(1000)
        try:
            if await pg.evaluate("typeof BOARD==='object'&&!!BOARD&&typeof CLIENT!=='undefined'&&CLIENT===" + json.dumps(slug)): break
        except Exception: pass
    else:
        raise RuntimeError(f"{slug}: the board never loaded")
    await pg.wait_for_timeout(2500)
    first = await pg.evaluate("()=>{const i=BOARD.items.find(i=>i.client_slug===CLIENT); return i?i.id:null}")
    if first: await pg.evaluate(f"()=>{{SEL='{first}';paintQueue();paintDetail()}}"); await pg.wait_for_timeout(1500)
    return await pg.evaluate(MARK), errs

async def main():
    token = os.environ.get("STUDIO_STAFF_TOKEN", "")
    if not token: print("STUDIO_STAFF_TOKEN is not set"); return 2
    preview = sys.argv[sys.argv.index("--preview") + 1] if "--preview" in sys.argv else None
    kw = {"proxy": {"server": os.environ["HTTPS_PROXY"]}} if os.environ.get("HTTPS_PROXY") else {}
    async with async_playwright() as p:
        b = await p.chromium.launch(**kw); ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        try:
            got = {s: await load(ctx, s, token, preview) for s in PAIR}
        except Exception as e:
            print("could not run:", e); return 2
        finally:
            await b.close()
    bad = []
    a, c = got[PAIR[0]][0], got[PAIR[1]][0]
    for k in a:
        if a[k] != c[k]: bad.append(f"layout marker '{k}' differs: {PAIR[0]}={a[k]} {PAIR[1]}={c[k]}")
    for s, (_, errs) in got.items():
        bad += [f"{s}: page error {e}" for e in errs]
    print("\n".join(bad) if bad else "same layout")
    return 1 if bad else 0

sys.exit(asyncio.run(main()))
