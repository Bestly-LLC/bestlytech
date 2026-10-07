#!/opt/bestly/turo-watch/.venv/bin/python
"""Turo reviews + performance reader/poster for Stella (runs on the Pi, venv python with playwright).

Attaches to the signed-in Turo Chromium on CDP 127.0.0.1:9334 (Turo blocks launched browsers), opens its own tab and
closes it again. Prints ONE JSON object on stdout. Never logs in, never types a password, never opens anything but Turo.

  turo_reviews_reader.py              read the Ratings & reviews page + the Performance page (read only)
  turo_reviews_reader.py --perf-only  Performance page only
  turo_reviews_reader.py --post       post ONE public reply. JSON on stdin: {"guest","date","text"}
                                      (only ever called by stella_queue for a reply Jared approved)
"""
import json
import re
import sys
import time

from playwright.sync_api import sync_playwright

CDP = "http://127.0.0.1:9334"
REVIEWS = "https://turo.com/us/en/business/reviews"
PERF = "https://turo.com/us/en/business/performance"

EXTRACT_JS = r"""
() => {
  const mon={January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12};
  return [...document.querySelectorAll('[data-testid="reviewList-review"]')].map((c,i)=>{
    const ps=[...c.querySelectorAll('p')].map(p=>p.innerText.trim());
    const st=c.querySelector('[aria-label^="Rating:"]')?.getAttribute('aria-label');
    const head=ps[0]||''; const m=head.match(/^(.*?)\s*•\s*(\w+) (\d+), (\d{4})/);
    const veh=(ps[1]||'').split('•').map(s=>s.trim());
    const btns=[...c.querySelectorAll('button')].map(b=>b.innerText.trim());
    return {i, guest:m?m[1]:head,
      date:m?`${m[4]}-${String(mon[m[2]]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`:null,
      stars:st?+st.match(/(\d)/)[1]:null, vehicle:veh[0]||'', plate:veh[1]||'',
      rest:ps.slice(2), respond: btns.some(b=>/public response/i.test(b))};
  });
}
"""

LOAD_MORE_JS = """() => { const b=[...document.querySelectorAll("button")].find(x=>/load more/i.test(x.innerText)); if(!b) return false; b.click(); return true; }"""


def signed_out(page):
    return "login" in page.url.lower() or page.query_selector('input[type=password]') is not None


def load_all(page, want=None):
    """Click 'Load more' until the list is complete (or the wanted review is on the page)."""
    for _ in range(15):
        if want and any(r["guest"] == want[0] and r["date"] == want[1] for r in page.evaluate(EXTRACT_JS)):
            return
        if not page.evaluate(LOAD_MORE_JS):
            return
        time.sleep(1.8)


def open_reviews(page):
    page.goto(REVIEWS, timeout=60000)
    page.wait_for_selector('[data-testid="reviewList-container"], input[type=password]', timeout=45000)


def read(perf_only):
    out = {"ok": False, "signed_in": None, "reviews": [], "summary_text": "", "perf_text": "", "error": None}
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP)
        page = browser.contexts[0].new_page()
        try:
            if not perf_only:
                open_reviews(page)
                if signed_out(page):
                    out["signed_in"], out["error"] = False, "Turo is signed out on the Pi browser"
                    return out
                out["signed_in"] = True
                load_all(page)
                out["reviews"] = page.evaluate(EXTRACT_JS)
                txt = page.inner_text("body")
                out["summary_text"] = txt[: txt.find("Category rating")] if "Category rating" in txt else txt[:2500]
            page.goto(PERF, timeout=60000)
            time.sleep(6)
            if signed_out(page):
                out["signed_in"], out["error"] = False, "Turo is signed out on the Pi browser"
            else:
                out["signed_in"] = True
                out["perf_text"] = page.inner_text("body")[:9000]
            out["ok"] = out["signed_in"] is True
        except Exception as e:  # noqa: BLE001
            out["error"] = f"{type(e).__name__}: {e}"[:400]
        finally:
            try:
                page.close()
            except Exception:  # noqa: BLE001
                pass
    return out


def post(req):
    """Post one public reply, then re-read the page and check that Turo shows it. Returns {ok, posted, error}."""
    guest, date, text = req["guest"], req["date"], req["text"].strip()
    out = {"ok": False, "posted": False, "error": None}
    if not text or len(text) < 20:
        out["error"] = "reply text is empty or too short"
        return out
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP)
        page = browser.contexts[0].new_page()
        try:
            open_reviews(page)
            if signed_out(page):
                out["error"] = "Turo is signed out on the Pi browser"
                return out
            load_all(page, (guest, date))
            rows = page.evaluate(EXTRACT_JS)
            hit = [r for r in rows if r["guest"] == guest and r["date"] == date]
            if len(hit) != 1:
                out["error"] = f"expected exactly one card for {guest} {date}, found {len(hit)}"
                return out
            row = hit[0]
            if not row["respond"]:
                out["error"] = "Turo is not offering a reply button on this review (already answered, or the window closed)"
                return out
            card = page.locator('[data-testid="reviewList-review"]').nth(row["i"])
            card.locator('[data-testid="respondToReviewView-showForm"]').click(timeout=15000)
            box = card.locator("textarea").first
            box.wait_for(timeout=15000)
            box.fill(text)
            time.sleep(0.6)
            sub = card.get_by_role("button", name=re.compile(r"^(post|submit|send|publish|respond)", re.I))
            if sub.count() != 1:
                out["error"] = f"could not find a single submit button (found {sub.count()}); text typed but NOT submitted"
                return out
            sub.first.click(timeout=15000)
            time.sleep(5)
            open_reviews(page)
            load_all(page, (guest, date))
            after = [r for r in page.evaluate(EXTRACT_JS) if r["guest"] == guest and r["date"] == date]
            seen = bool(after) and any(text[:40] in t for t in after[0]["rest"])
            out["posted"], out["ok"] = seen, seen
            if not seen:
                out["error"] = "submitted, but the reply did not show up on re-read"
        except Exception as e:  # noqa: BLE001
            out["error"] = f"{type(e).__name__}: {e}"[:400]
        finally:
            try:
                page.close()
            except Exception:  # noqa: BLE001
                pass
    return out


def main():
    if "--post" in sys.argv:
        res = post(json.loads(sys.stdin.read()))
    else:
        res = read("--perf-only" in sys.argv)
    print(json.dumps(res))
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
