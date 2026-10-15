# Inbox faces (2026-10-15): a sender we have a photo for shows it in the inbox row instead of the initial.
# Exact-once patch on the live index.html (index 59dc1f5064). Usage: python3 patch_index.py live.html new.html
import sys, base64, os
FACE = "data:image/jpeg;base64," + base64.b64encode(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "elizabeth-96.jpg"), "rb").read()).decode()
src = open(sys.argv[1], encoding="utf-8").read()
def rep(old, new, count=1):
    global src
    n = src.count(old)
    assert n == count, f"expected {count} got {n} for: {old[:80]!r}"
    src = src.replace(old, new)

rep(".ib-av{flex:0 0 36px;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--fill);color:var(--ink);font-weight:700;font-size:15px}",
    ".ib-av{flex:0 0 36px;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--fill);color:var(--ink);font-weight:700;font-size:15px}\n"
    ".ib-av{overflow:hidden}.ib-av img{width:100%;height:100%;object-fit:cover;border-radius:50%;display:block}")

rep('const ibFrom = (m) => (m.from_name && m.from_name.trim()) || m.from_addr || "Someone";',
    'const ibFrom = (m) => (m.from_name && m.from_name.trim()) || m.from_addr || "Someone";\n'
    '// a face for senders we have a photo of; the initial comes back if the photo will not load\n'
    'const IB_FACES = { "elizabethobrienlpc@gmail.com": ' + repr(FACE).replace("'", '"') + ' };\n'
    'const ibAv = (m) => { const i = esc(ibFrom(m).trim().charAt(0).toUpperCase()), f = IB_FACES[String(m.from_addr || "").trim().toLowerCase()];\n'
    '  return f ? `<img src="${esc(f)}" alt="" data-i="${i}" onerror="this.parentNode.textContent=this.dataset.i">` : i; };')

rep('<span class="ib-av" aria-hidden="true">${esc(ibFrom(m).trim().charAt(0).toUpperCase())}</span>',
    '<span class="ib-av" aria-hidden="true">${ibAv(m)}</span>')

open(sys.argv[2], "w", encoding="utf-8").write(src)
print("ok")
