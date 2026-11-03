/* BUSPROTO_20261102 - Buses card prototype for the sign-wall shared slot (preview only; NOT in wall.html).
   Eval it in a main-mode test tab. Self-contained (the page's own helpers live in a closure): it fetches /api/bus itself,
   copies the container look of the pinned Local alerts / Airports cards, and sits in the #wingBus slot (wing 20,20 - 980,488, 960 x 468, 1:1).
   Real build: move lboCss + lboRows + lboHtml + lboFit into the MAINCLEAN block, call from v2BusPaint instead of v2BusHtml. */
(async () => {
  if (window.__lboStop) window.__lboStop();
  const NBP = ' ';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const t12 = ms => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/[   ]/g, NBP);
  const realNow = () => performance.timeOrigin + performance.now();   // the harness fakes Date; live eta values are real-clock

  /* ---------- CSS: container = computed look of #wingAlerts .al (bg .055, inset 2 px ring .15, radius 36, padding 14 18 12) ---------- */
  document.getElementById('lboCss') && document.getElementById('lboCss').remove();
  const css = document.createElement('style'); css.id = 'lboCss';
  css.textContent = `
#wingFlight,#wingKey,#wingBus{opacity:0!important;visibility:hidden!important}
#lboHost{position:fixed;left:0;top:0;width:960px;height:468px;transform-origin:0 0;z-index:6;pointer-events:none;font-family:var(--sf)}
#lboHost .lbo{box-sizing:border-box;width:960px;padding:14px 18px 12px;border-radius:36px;color:#fff;background:rgba(255,255,255,.055);box-shadow:inset 0 0 0 2px rgba(255,255,255,.15);overflow:hidden}
#lboHost .lbo-hd{margin:0 0 4px;font:800 26px/26px var(--sf);letter-spacing:.04em;text-transform:uppercase;color:#fff;white-space:nowrap}
#lboHost .lbo-r{position:relative;display:grid;grid-template-columns:64px minmax(0,1fr) 250px;column-gap:24px;align-items:center;padding:13px 0;white-space:nowrap}
#lboHost .lbo-r+.lbo-r::after{content:"";position:absolute;left:88px;right:0;top:0;height:1px;background:rgba(255,255,255,.10)}
#lboHost .lbo-r>*{position:relative;z-index:1}
#lboHost .lbo-b{box-sizing:border-box;width:64px;height:52px;border-radius:14px;background:var(--c);display:grid;place-items:center;color:#fff;font:700 40px/1 "Big Shoulders Display",var(--sf);box-shadow:0 0 12px 3px color-mix(in srgb,var(--c) 30%,transparent);overflow:hidden}
#lboHost .lbo-b img{display:block;height:34px;width:auto;max-width:54px}
#lboHost .lbo-s{min-width:0}
#lboHost .lbo-n{display:block;font:600 30px/1.1 var(--sf);color:#fff;overflow:hidden;text-overflow:clip}
#lboHost .lbo-w{display:block;margin-top:3px;font:500 22px/1.15 var(--sf);color:rgba(255,255,255,.85);overflow:hidden;text-overflow:clip}
#lboHost .lbo-e{text-align:right}
#lboHost .lbo-m{display:block;font:700 52px/1 var(--sf);font-variant-numeric:tabular-nums;color:#fff;white-space:nowrap}
#lboHost .lbo-r.sch .lbo-m{color:rgba(255,255,255,.85)}
#lboHost .lbo-l{display:block;margin-top:5px;font:600 22px/1.15 var(--sf);color:#fff;white-space:nowrap}
#lboHost .lbo-r.now .lbo-l{color:#FFC440}
#lboHost .lbo-r.now::before{content:"";position:absolute;left:-10px;right:-10px;top:-2px;bottom:-2px;z-index:0;pointer-events:none;
  background:radial-gradient(ellipse closest-side at 50% 50%,rgba(255,196,64,.30) 0,rgba(255,196,64,.16) 55%,rgba(255,196,64,0) 100%);
  opacity:.8;animation:lboPulse 2.6s ease-in-out 3 forwards}
@keyframes lboPulse{0%{opacity:.5}50%{opacity:1}100%{opacity:.8}}
@media (prefers-reduced-motion:reduce){#lboHost .lbo-r.now::before{animation:none;opacity:.8}}
#lboHost .lbo-ft{display:flex;justify-content:space-between;align-items:baseline;gap:18px;margin-top:6px;min-height:26px;white-space:nowrap}
#lboHost .lbo-dt{min-width:0;flex:1;font:600 22px/1.2 var(--sf);color:#FF9F0A;overflow:hidden;text-overflow:clip}
#lboHost .lbo-sg{flex:none;margin-left:auto;font:700 22px/1 var(--sf);letter-spacing:.03em;color:#fff}`;
  document.head.appendChild(css);

  /* ---------- data ---------- */
  const key = r => { const s = (String(r.line || '') + ' ' + String(r.name || '')).toUpperCase(); if (/CITY/.test(s)) return 'CITYLINE'; if (/DASH|FAIRFAX/.test(s)) return 'FAIRFAX'; const m = String(r.line || r.name || '').match(/\b(105|10|4)\b/); return m ? m[1] : null; };
  let bus = null; try { bus = await (await fetch('/api/bus', { cache: 'no-store' })).json(); } catch (e) { }
  const now = Date.now(), shift = now - realNow();          // show live data on the faked clock, same minutes
  const by = {};
  ((bus && bus.lines) || []).forEach(r => { const k = key(r); if (!k) return;
    if (k === '105' && !/LAX/i.test((r.toward || '') + ' ' + (r.direction || '') + ' ' + (r.headsign || ''))) return;
    const arr = (r.arrivals || []).map(a => ({ eta: a.eta + shift, live: !!a.live })).filter(a => a.eta > now - 30000);
    const walk = r.walk_min != null ? r.walk_min : 5;
    const c = arr.find(a => a.eta - walk * 60000 > now - 30000); if (!c) return;
    const row = { k, stop: r.stop || '', dir: r.direction || '', toward: r.toward || '', walk, eta: c.eta, live: !!(c.live && r.live && !r.stale && !r.approx && k !== 'CITYLINE' && k !== 'FAIRFAX'), src: 'live' };
    if (!by[k] || row.eta < by[k].eta) by[k] = row; });
  const S = {
    '10': { k: '10', stop: 'Melrose / Orlando', dir: 'Westbound', walk: 3, eta: now + 3.6 * 60000, live: true, src: 'sample' },
    '105': { k: '105', stop: 'La Cienega / Waring', dir: 'Southbound', toward: 'Toward LAX', walk: 7, eta: now + 19 * 60000, live: true, src: 'sample' },
    'CITYLINE': { k: 'CITYLINE', stop: 'Santa Monica / Kings Rd', dir: 'Eastbound', walk: 5, eta: now + 27 * 60000, live: false, src: 'sample' } };
  let rows = Object.values(by);
  const near = r => r.eta - r.walk * 60000 - now <= 60000;
  if (!rows.some(near)) { rows = rows.filter(r => r.k !== '10'); rows.push(S['10']); }       // one leave-now row for the preview
  ['105', 'CITYLINE'].forEach(k => { if (rows.length < 3 && !rows.some(r => r.k === k)) rows.push(S[k]); });
  rows.forEach(r => { r.leave = r.eta - r.walk * 60000; });
  rows.sort((a, b) => a.leave - b.leave); rows = rows.slice(0, 3);
  const detour = 'Line 4 detour: Santa Monica Blvd closed at La Brea';   // mock; real build: first Metro alert on a shown line

  /* ---------- html ---------- */
  let logo = ''; try { const m = (await (await fetch('/wall', { cache: 'force-cache' })).text()).match(/CITY_LOGO\s*=\s*'([^']+)'/); logo = m ? m[1] : ''; } catch (e) { }
  const badge = r => r.k === 'CITYLINE' ? `<div class="lbo-b" style="--c:#E63540">${logo ? `<img src="${logo}" alt="">` : 'CL'}</div>`
    : `<div class="lbo-b" style="--c:${r.k === 'FAIRFAX' ? '#8A2528' : '#E16710'}"><span class="lbo-bn">${r.k === 'FAIRFAX' ? 'DASH' : r.k}</span></div>`;
  const slash = s => esc(s).replace(/ \/ /g, NBP + '/ ');
  const html = rows => `<div class="lbo"><div class="lbo-hd">Buses</div>${rows.map(r => {
    const m = Math.max(0, Math.round((r.eta - now) / 60000)), nowGo = r.leave - now <= 60000;
    const sub = (r.live ? (r.k === '105' ? 'Toward LAX' : r.dir) : 'Scheduled') + ' · ' + r.walk + NBP + 'min walk';
    return `<div class="lbo-r${nowGo ? ' now' : ''}${r.live ? '' : ' sch'}">${badge(r)}<div class="lbo-s"><span class="lbo-n">${slash(r.stop)}</span><span class="lbo-w">${esc(sub)}</span></div>`
      + `<div class="lbo-e"><span class="lbo-m">${m < 1 ? 'Now' : m + NBP + 'min'}</span><span class="lbo-l">${nowGo ? 'Leave now' : 'Leave' + NBP + 'by' + NBP + t12(r.leave)}</span></div></div>`; }).join('')}`
    + `<div class="lbo-ft"><span class="lbo-dt">${esc(detour)}</span><span class="lbo-sg">Mae</span></div></div>`;

  /* ---------- fit: shrink to a floor, then drop trailing whole words; never ellipsis ---------- */
  const fit = (el, floor) => { if (!el || !el.clientWidth) return; const ov = () => el.scrollWidth > el.clientWidth + 1; let s = parseFloat(getComputedStyle(el).fontSize);
    while (ov() && s > floor) { s -= 1; el.style.fontSize = s + 'px'; }
    if (ov()) { const p = el.textContent.split(/\s+/); while (p.length > 1 && ov()) { p.pop(); el.textContent = p.join(' '); } } };
  const paint = () => { host.innerHTML = html(rows);
    host.querySelectorAll('.lbo-n').forEach(e => fit(e, 24)); host.querySelectorAll('.lbo-w').forEach(e => fit(e, 20)); host.querySelectorAll('.lbo-dt').forEach(e => fit(e, 20));
    host.querySelectorAll('.lbo-bn').forEach(e => { const b = e.parentNode; let s = 40; e.style.fontSize = s + 'px'; while (e.scrollWidth > b.clientWidth - 8 && s > 24) { s -= 1; e.style.fontSize = s + 'px'; } if (e.textContent === 'DASH') e.style.fontSize = Math.min(s, 30) + 'px'; }); };
  let host = document.getElementById('lboHost'); if (host) host.remove();
  host = document.createElement('div'); host.id = 'lboHost'; document.body.appendChild(host);
  const sync = () => { const w = document.getElementById('wingBus'); if (w && w.style.transform) host.style.transform = w.style.transform; };
  sync(); paint(); const iv = setInterval(sync, 300);
  window.__lboStop = () => { clearInterval(iv); host.remove(); css.remove(); };
  window.__lbo = () => ({ rows: rows.map(r => [r.k, r.stop, r.src, r.live, Math.round((r.eta - now) / 60000), Math.round((r.leave - now) / 60000)]) });
  return JSON.stringify(window.__lbo());
})()
