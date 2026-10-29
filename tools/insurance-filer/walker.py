"""The browser half of the Insurance Filer: walks an insurer's online claim form one screen at a time and fills it from the packet.

Written for Progressive's guest claim flow (an Assured single-page app: one question per screen, screen id in
[data-testid=wf-step-key], title in #page-title), but label-driven, so another insurer's wizard works the same way. Only two Progressive
screens have been seen live (safety question; name + phone + consent). Everything after them is handled by rules, not memory, and
anything the rules cannot answer STOPS the run and goes to Jared, with every answer so far ready to copy.

THREE MODES (the mode is the safety):
  dry     rehearsal. Fills what it can. NEVER clicks a consent button and NEVER clicks a final submit. Safe against a live site.
  fill    the real fill pass before Jared's tap. Clicks consent only if the job says consent_before_tap (needed to reach later
          screens). NEVER clicks a final submit.
  submit  after Jared's tap on the exact packet he saw. Re-fills, checks the packet hash again, then clicks final submit once.

Never bypasses a CAPTCHA or bot check: it stops and reports blocked, and Jared finishes by hand with every answer ready.
Python 3.9 compatible.
"""
import os
import re
import time

import rules

MAX_SCREENS = 40

SNAP_JS = r"""() => {
  const vis = e => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return (r.width > 0 || r.height > 0) && st.visibility !== 'hidden' && st.display !== 'none'; };
  const txt = e => ((e && (e.innerText || e.textContent)) || '').replace(/\s+/g, ' ').trim();
  const lab = e => {
    let l = '';
    if (e.labels && e.labels.length) l = txt(e.labels[0]);
    if (!l) l = e.getAttribute('aria-label') || '';
    if (!l && e.getAttribute('aria-labelledby')) l = e.getAttribute('aria-labelledby').split(/\s+/).map(i => txt(document.getElementById(i))).join(' ');
    if (!l) l = e.placeholder || e.name || e.id || '';
    return l.trim();
  };
  document.querySelectorAll('[data-ins-i],[data-ins-c],[data-ins-b]').forEach(e => { e.removeAttribute('data-ins-i'); e.removeAttribute('data-ins-c'); e.removeAttribute('data-ins-b'); });
  const fields = []; const radios = {}; let fi = 0;
  document.querySelectorAll('input,select,textarea').forEach(e => {
    const t = (e.type || e.tagName).toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset'].includes(t)) return;
    if (t !== 'file' && !vis(e)) return;
    const i = fi++; e.setAttribute('data-ins-i', i);
    if (t === 'radio') {
      const g = e.name || ('r' + i);
      if (!radios[g]) {
        const fs = e.closest('fieldset,[role=radiogroup],[role=group]');
        const lg = fs && (fs.querySelector('legend') || document.getElementById(fs.getAttribute('aria-labelledby') || '_'));
        radios[g] = {type: 'radio', label: txt(lg), options: []}; fields.push(radios[g]);
      }
      radios[g].options.push({i, label: lab(e), checked: e.checked}); return;
    }
    fields.push({i, tag: e.tagName.toLowerCase(), type: t, id: e.id, label: lab(e), placeholder: e.placeholder || '',
      required: !!e.required || e.getAttribute('aria-required') === 'true', value: e.value || '', checked: !!e.checked, accept: e.accept || '',
      invalid: e.getAttribute('aria-invalid') === 'true',
      options: e.tagName === 'SELECT' ? [...e.options].map(o => ({value: o.value, text: txt(o)})) : null});
  });
  const choices = []; let ci = 0;
  document.querySelectorAll('[role=group] button, button.select-btn, [role=radio]').forEach(e => {
    if (!vis(e)) return; const i = ci++; e.setAttribute('data-ins-c', i);
    choices.push({i, label: e.getAttribute('aria-label') || ((e.innerText || '').split('\n')[0] || '').trim(), text: txt(e)});
  });
  const buttons = []; let bi = 0;
  document.querySelectorAll('button,[role=button],input[type=submit],input[type=button],a.btn').forEach(e => {
    if (!vis(e) || e.hasAttribute('data-ins-c')) return; const i = bi++; e.setAttribute('data-ins-b', i);
    buttons.push({i, label: (e.getAttribute('aria-label') || txt(e) || e.value || '').trim(), disabled: !!e.disabled || e.getAttribute('aria-disabled') === 'true'});
  });
  const h = document.querySelector('#page-title, h1, [role=heading], legend');
  const body = (document.body.innerText || '').replace(/[ \t]+/g, ' ').slice(0, 6000);
  const cons = [...document.querySelectorAll('div,p,span,label')].filter(e => /by (clicking|continuing|submitting|selecting)/i.test(e.innerText || ''))
    .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0];
  const sk = document.querySelector('[data-testid="wf-step-key"]');
  const frames = [...document.querySelectorAll('iframe')].map(f => f.src || '').join(' ');
  return {url: location.href, step_key: sk ? txt(sk) : null, title: txt(h), fields, choices, buttons, body,
    consent_text: cons ? txt(cons).slice(0, 900) : null,
    errors: [...document.querySelectorAll('[role=alert],[class*=error],[class*=Error]')].filter(vis).map(txt).filter(Boolean).slice(0, 5),
    captcha_frame: /recaptcha|hcaptcha|turnstile|px-captcha|captcha/i.test(frames) || !!document.querySelector('.g-recaptcha,.h-captcha,[data-sitekey]')};
}"""


def accepts(accept, path):
    """Does a file input's accept attribute allow this file? Empty accept allows anything."""
    a = (accept or "").lower()
    if not a.strip():
        return True
    ext = os.path.splitext(path)[1].lower()
    mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf"}.get(ext, "")
    for tok in [t.strip() for t in a.split(",") if t.strip()]:
        if tok == mime or tok == ext or (tok.endswith("/*") and mime.startswith(tok[:-1])):
            return True
    return False


class Stop(Exception):
    """The walk ended on purpose. kind: consent | review | submitted | blocked | stale | error"""
    def __init__(self, kind, reason=""):
        Exception.__init__(self, "%s: %s" % (kind, reason))
        self.kind = kind
        self.reason = reason


class Walker:
    def __init__(self, page, values, mode="dry", shots_dir=None, consent_before_tap=True, fetch_photos=None, packet_hash=None,
                 approved_hash=None, turo_claim_no=None, unknown_why=None, on_shot=None, log=None, seconds=480):
        assert mode in ("dry", "fill", "submit")
        self.page = page
        self.values = values or {}
        self.mode = mode
        self.shots_dir = shots_dir
        self.consent_before_tap = bool(consent_before_tap)
        self.fetch_photos = fetch_photos            # callable() -> list of local file paths (jpg/png/pdf)
        self.packet_hash = packet_hash
        self.approved_hash = approved_hash
        self.turo_claim_no = turo_claim_no
        self.unknown_why = unknown_why or {}         # packet key -> why it is unknown
        self.on_shot = on_shot
        self.log = log or (lambda *a: None)
        self.deadline = time.time() + seconds
        self.screens = []
        self.filled = []
        self.left_blank = []
        self.shots = []
        self.consent = []
        self.consent_clicked = False
        self.final_clicked = False
        self.photos_uploaded = 0
        self._photo_files = None
        self.n = 0

    # ------------------------------------------------------------------ helpers
    def snap(self):
        for _ in range(3):
            try:
                return self.page.evaluate(SNAP_JS)
            except Exception as e:                    # the page navigated under us
                time.sleep(0.8)
                last = e
        raise Stop("error", "could not read the page: %s" % str(last)[:120])

    def shot(self, label):
        if not self.shots_dir:
            return None
        os.makedirs(self.shots_dir, exist_ok=True)
        name = "%02d-%s.png" % (self.n, re.sub(r"[^a-z0-9]+", "-", (label or "screen").lower()).strip("-")[:40])
        path = os.path.join(self.shots_dir, name)
        try:
            self.page.screenshot(path=path, full_page=True)
        except Exception:
            return None
        self.shots.append(name)
        if self.on_shot:
            try:
                self.on_shot(path, name)
            except Exception as e:
                self.log("screenshot upload failed:", e)
        return name

    @staticmethod
    def sig(s):
        return "|".join([s.get("step_key") or "", s.get("title") or "",
                         ",".join(f.get("label", "") for f in s.get("fields", [])), ",".join(c["label"] for c in s.get("choices", []))])

    def wait_change(self, before, seconds=9):
        end = time.time() + seconds
        while time.time() < end:
            time.sleep(0.6)
            try:
                if self.sig(self.page.evaluate(SNAP_JS)) != before:
                    time.sleep(0.8)
                    return True
            except Exception:
                time.sleep(0.5)
                return True
        return False

    def unknown(self, key, label, screen):
        why = self.unknown_why.get(key) or "No answer on file for this"
        self.left_blank.append({"key": key or label, "label": label, "why": why, "screen": screen})

    # ------------------------------------------------------------------ one field
    def do_field(self, f, s, answers):
        t = f.get("type")
        title = s.get("title") or ""
        label = f.get("label") or f.get("placeholder") or ""
        loc = self.page.locator('[data-ins-i="%d"]' % f["i"]) if "i" in f else None
        if t == "file":
            return self.do_files(f)
        if t == "radio":
            opts = [o["label"] for o in f["options"]]
            pick, key, note = rules.choose(f.get("label") or title, opts, self.values)
            if not pick:
                self.unknown(None, f.get("label") or title, self.n)
                return
            o = [o for o in f["options"] if o["label"] == pick][0]
            self.page.locator('[data-ins-i="%d"]' % o["i"]).check(force=True)
            answers.append({"key": key, "label": f.get("label") or title, "value": pick})
            return
        if t == "checkbox":
            if rules.CONSENT_RE.search(label) or re.search(r"(i (agree|accept|acknowledge|confirm|certify)|terms|privacy)", label, re.I):
                self.consent.append("Checkbox: " + label[:200])
                if self.mode != "dry" and self.consent_before_tap:
                    if not f.get("checked"):
                        loc.check(force=True)
                    self.consent_clicked = True
            else:
                self.unknown(None, label, self.n)
            return
        key = rules.key_for_text(label, title)
        val = rules.text_value(key, self.values, title)
        if key in ("loss.time", "vehicle.color") and not val:
            self.unknown(key, label, self.n)
            return
        if val is None:
            self.unknown(key, label, self.n)
            return
        if f.get("tag") == "select":
            opts = f.get("options") or []
            wanted = rules.state_forms(val) if key in ("loss.state", "vehicle.plate_state") else [val]
            pick = rules.pick_option([{"value": o["value"], "text": o["text"]} for o in opts], wanted)
            if not pick:
                self.unknown(key, label, self.n)
                return
            loc.select_option(label=pick)
            answers.append({"key": key, "label": label, "value": pick})
            return
        if t == "date":
            m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", val)
            if m:
                val = "%s-%02d-%02d" % (m.group(3), int(m.group(1)), int(m.group(2)))
        loc.fill(val[:2000])
        got = loc.input_value()
        if rules.digits(got) != rules.digits(val) and t in ("tel", "number"):
            loc.fill("")
            loc.type(val, delay=15)
        answers.append({"key": key, "label": label, "value": val[:200]})

    def do_files(self, f):
        if self._photo_files is None:
            try:
                self._photo_files = list(self.fetch_photos() or []) if self.fetch_photos else []
            except Exception as e:
                self.log("photo download failed:", e)
                self._photo_files = []
        files = [p for p in self._photo_files if accepts(f.get("accept"), p)][:10]
        if not files:
            self.left_blank.append({"key": "photos", "label": f.get("label") or "Photos", "why": "No photos on file yet, or the form does not take this file type", "screen": self.n})
            return
        self.page.locator('[data-ins-i="%d"]' % f["i"]).set_input_files(files)
        self.photos_uploaded += len(files)
        time.sleep(2.5)

    # ------------------------------------------------------------------ the walk
    def run(self):
        """-> result dict (reached, consent_clicked, consent, screens, filled, left_blank, shots, photos_uploaded, blocked_reason, claim_no ...)"""
        out = {"reached": None, "blocked_reason": None, "claim_no": None, "confirmation_text": None}
        last_sig, same = None, 0
        try:
            for _ in range(MAX_SCREENS):
                if time.time() > self.deadline:
                    raise Stop("blocked", "I ran out of time on this form")
                self.n += 1
                time.sleep(1.2)
                s = self.snap()
                bot = rules.BOT_RE.search(s.get("body") or "") if len(s.get("fields", [])) == 0 and len(s.get("choices", [])) == 0 else None
                if s.get("captcha_frame") or bot:
                    self.shot("bot-check")
                    raise Stop("blocked", "The site put up a bot check (CAPTCHA). I do not get around those.")
                sg = self.sig(s)
                same = same + 1 if sg == last_sig else 0
                last_sig = sg
                if same >= 2:
                    self.shot("stuck")
                    left = ", ".join(b["label"] for b in self.left_blank[-4:]) or "something on this screen"
                    raise Stop("blocked", "The form would not go on: %s%s" % (("; ".join(s["errors"])[:160] + ". ") if s.get("errors") else "", "Still open: " + left))
                step = {"n": self.n, "step_key": s.get("step_key"), "question": (s.get("title") or "")[:200], "answers": [], "shot": None}
                self.screens.append(step)

                # a screen of big choice buttons (Yes / No, loss type...)
                if s["choices"] and not [f for f in s["fields"] if f.get("type") not in ("radio",)]:
                    opts = [c["label"] for c in s["choices"]]
                    pick, key, note = rules.choose(s.get("title") or "", opts, self.values)
                    if not pick:
                        step["shot"] = self.shot("question")
                        raise Stop("blocked", "The form asked \"%s\" and I have no answer on file for it. %s" % ((s.get("title") or "")[:140], note or ""))
                    c = [c for c in s["choices"] if c["label"] == pick][0]
                    step["answers"].append({"key": key, "label": (s.get("title") or "")[:120], "value": pick})
                    self.filled.append({"key": key, "label": (s.get("title") or "")[:120], "value": pick, "screen": self.n})
                    step["shot"] = self.shot(s.get("step_key") or "choice")
                    self.page.locator('[data-ins-c="%d"]' % c["i"]).click()
                    self.wait_change(sg)
                    continue

                # fields
                blank_before = len(self.left_blank)
                for f in s["fields"]:
                    try:
                        self.do_field(f, s, step["answers"])
                    except Stop:
                        raise
                    except Exception as e:
                        self.unknown(None, (f.get("label") or "a field") + " (" + str(e)[:60] + ")", self.n)
                for a in step["answers"]:
                    a["screen"] = self.n
                    self.filled.append(a)
                step["left_blank"] = [b["label"] for b in self.left_blank[blank_before:]]

                # the way forward
                btns = [(rules.classify_button(b["label"]), b) for b in s["buttons"]]
                btns = [(k, b) for k, b in btns if k != "skip"]
                final = [b for k, b in btns if k == "final" and not b["disabled"]]
                consent = [b for k, b in btns if k == "consent" and not b["disabled"]]
                adv = [b for k, b in btns if k == "advance" and not b["disabled"]]
                step["shot"] = self.shot(s.get("step_key") or (s.get("title") or "screen"))

                if consent:
                    txt = s.get("consent_text") or ""
                    self.consent.append("%s: %s" % (consent[0]["label"], txt[:700]))
                    if self.mode == "dry" or not self.consent_before_tap:
                        out["reached"] = "consent"
                        return self.finish(out)
                    self.consent_clicked = True
                    self.page.locator('[data-ins-b="%d"]' % consent[0]["i"]).click()
                    self.wait_change(sg)
                    continue
                if final:
                    if self.mode in ("dry", "fill"):
                        out["reached"] = "review"
                        out["review_text"] = (s.get("body") or "")[:2500]
                        return self.finish(out)
                    # submit mode: the very last check, then one click
                    if self.approved_hash and self.packet_hash != self.approved_hash:
                        raise Stop("stale", "The facts changed after you approved. I did not send. Open the card and approve again.")
                    self.final_clicked = True
                    self.page.locator('[data-ins-b="%d"]' % final[0]["i"]).click()
                    self.wait_change(sg, 20)
                    time.sleep(2.0)
                    s2 = self.snap()
                    self.n += 1
                    self.shot("confirmation")
                    out["reached"] = "submitted"
                    out["confirmation_text"] = (s2.get("body") or "")[:700]
                    out["claim_no"] = rules.claim_no_from(s2.get("body") or "", self.turo_claim_no)
                    return self.finish(out)
                if adv:
                    self.page.locator('[data-ins-b="%d"]' % adv[0]["i"]).click()
                    self.wait_change(sg)
                    continue
                if s["choices"] or not s["buttons"]:
                    # radios answered but no button, or a screen that moves by itself: give it a moment
                    if not self.wait_change(sg, 6):
                        raise Stop("blocked", "I could not find a way forward on: %s" % (s.get("title") or "this screen")[:140])
                    continue
                raise Stop("blocked", "I could not tell which button goes on: %s" % ", ".join(b["label"] for b in s["buttons"])[:140])
            raise Stop("blocked", "The form went on longer than any claim form should. I stopped.")
        except Stop as e:
            if e.kind in ("blocked", "stale", "error"):
                out["reached"] = out["reached"] or e.kind
                out["blocked_reason"] = e.reason
            return self.finish(out, stop=e.kind)

    def finish(self, out, stop=None):
        out.update({"url": self.page.url, "consent_clicked": self.consent_clicked, "consent": self.consent, "screens": self.screens,
                    "filled": self.filled, "left_blank": self.left_blank, "shots": self.shots, "photos_uploaded": self.photos_uploaded,
                    "mode": self.mode, "stop": stop, "not_sent": not self.final_clicked})
        return out


def open_claim(page, url, log=None):
    """Load the insurer's claim entry page and wait for the wizard. Progressive redirects to its Assured app by itself after ~45 s."""
    log = log or (lambda *a: None)
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    try:
        page.wait_for_load_state("networkidle", timeout=45000)
    except Exception:
        pass
    time.sleep(6)
    for _ in range(6):
        try:
            n = page.evaluate("() => document.querySelectorAll('input,select,textarea,button').length")
        except Exception:
            n = 0
        if n > 2:
            break
        time.sleep(3)
    return page.url
