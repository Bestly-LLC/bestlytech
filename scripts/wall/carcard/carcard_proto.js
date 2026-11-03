/* CARCARD preview prototype (2026-11-03). NOT in the live wall.html: injected into a separate test tab by tab2.mjs.
   A "Cars" page in the center-right rotating card slot (.rightp/.cards, 410 x 216 stage px), right after the Blue Steel / Turo card.
   Same container as the other cards: article.card, .hdr + .sym icon + .app, .r rise-in, Big Shoulders hero like .big, Mae signature like .w1-sg.
   The column is 280 px wide on purpose: the TV-shadow mask slants across this slot, so the free width at the bottom rows is ~280 px (a wider
   block got cut by the mask). The wrapper also carries class "rings" so the wall's own avoidMask() zooms it (min .62) instead of clipping if the mask moves.
   Data = wall_car_charge_plan(p_token) JSON {station, cars[]}; feed() takes the same shape (+ optional per-car trip_end, sweep:{move_by}, charge_now).
   Real patch (later): poll the RPC like W5/devices, add  o=carOrder(o)  next to devOrder in buildOrder, exactly as cDev does.
   Nothing animates at rest (only the card's own rise-in). No ellipsis anywhere: text shrinks, then wraps whole words. */
(function(){
  if (window.CARCARD && window.CARCARD._v) return 'already';
  const TZ = 'America/Los_Angeles', NB = ' ';
  const css = document.createElement('style'); css.id = 'carccss';
  css.textContent = `
#cCar{--W:280px;gap:0;}
#cCar .hdr{width:var(--W);}
#cCar .hdr .meta{font:600 19px/1 var(--sf);letter-spacing:-.005em;color:rgba(245,245,247,.74);white-space:nowrap;}
#cCar .cc-wrap.rings{display:flex;flex-direction:column;gap:9px;width:var(--W);margin-top:9px;align-items:stretch;}
#cCar .cc-list{display:flex;flex-direction:column;width:100%;transform-origin:0 0;}
#cCar .cc-car{display:flex;flex-direction:column;gap:7px;width:100%;}
#cCar .cc-list.d1{--ic:46px;--hs:62px;--rs:20px;--nm:23px;--p1:19px;--p2:17px;}
#cCar .cc-list.d2{--ic:34px;--hs:38px;--rs:16px;--nm:20px;--p1:17px;--p2:15.5px;}
#cCar .cc-list.d3{--ic:26px;--hs:30px;--rs:15px;--nm:18px;--p1:15px;--p2:15px;}
#cCar .cc-list.d2 .cc-car{gap:3px;} #cCar .cc-list.d3 .cc-car{gap:2px;}
#cCar .cc-list.d2 .cc-car+.cc-car{margin-top:7px;padding-top:7px;border-top:1px solid rgba(235,235,245,.10);}
#cCar .cc-list.d3 .cc-car+.cc-car{margin-top:5px;padding-top:5px;border-top:1px solid rgba(235,235,245,.10);}
#cCar .cc-top{display:flex;align-items:center;gap:12px;min-height:var(--ic);}
#cCar .cc-ic{position:relative;flex:none;width:var(--ic);height:var(--ic);border-radius:calc(var(--ic)*.32);display:grid;place-items:center;
  background:rgba(235,235,245,.06);box-shadow:inset 0 0 0 1px rgba(235,235,245,.10);color:var(--tint,rgba(235,235,245,.82));}
#cCar .cc-ic svg{width:62%;height:62%;}
#cCar .cc-nm{font:600 var(--nm)/1.08 var(--sf);letter-spacing:-.015em;color:#fff;min-width:0;flex:1 1 0;overflow-wrap:normal;}
#cCar .cc-hero{margin-left:auto;flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:3px;text-align:right;}
#cCar .cc-list.d2 .cc-hero,#cCar .cc-list.d3 .cc-hero{flex-direction:row;align-items:baseline;gap:7px;}
#cCar .cc-hero b{font:800 var(--hs)/.84 "Big Shoulders Display",var(--sf);letter-spacing:0;color:#fff;white-space:nowrap;}
#cCar .cc-hero b small{font:inherit;font-size:.5em;margin-left:2px;opacity:.72;}
#cCar .cc-hero i{font:600 var(--rs)/1.1 var(--sf);font-style:normal;color:rgba(245,245,247,.74);white-space:nowrap;}
#cCar .cc-bar{position:relative;height:5px;border-radius:3px;background:rgba(235,235,245,.13);margin:2px 0 3px;}
#cCar .cc-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--bc,var(--green));
  -webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 12px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 12px),transparent);}
#cCar .cc-bar u{position:absolute;top:-2px;bottom:-2px;width:2px;margin-left:-1px;border-radius:1px;background:rgba(245,245,247,.42);}
#cCar .cc-st{display:flex;align-items:flex-start;gap:9px;color:rgba(255,255,255,.95);}
#cCar .cc-sl{flex:none;width:18px;height:calc(var(--p1)*1.2);display:grid;place-items:center;}
#cCar .cc-sl b{width:9px;height:9px;border-radius:50%;background:var(--sc,var(--green));display:block;}
#cCar .cc-sl svg{width:18px;height:18px;}
#cCar .cc-tx{min-width:0;flex:1 1 0;display:flex;flex-direction:column;gap:1px;}
#cCar .cc-tx .p1{font:600 var(--p1)/1.2 var(--sf);letter-spacing:-.008em;}
#cCar .cc-tx .p2{font:500 var(--p2)/1.2 var(--sf);letter-spacing:-.005em;opacity:.78;}
#cCar .cc-tx .p1,#cCar .cc-tx .p2{white-space:nowrap;}
#cCar .cc-car.st-now .cc-st{color:var(--yellow);} #cCar .cc-car.st-now{--sc:var(--yellow);--bc:var(--yellow);}
#cCar .cc-car.st-wont .cc-st,#cCar .cc-car.st-sweep .cc-st{color:var(--orange);} #cCar .cc-car.st-wont,#cCar .cc-car.st-sweep{--sc:var(--orange);--bc:var(--orange);}
#cCar .cc-car.st-trip .cc-st,#cCar .cc-car.st-stale .cc-st{color:rgba(245,245,247,.72);} #cCar .cc-car.st-trip,#cCar .cc-car.st-stale{--sc:rgba(235,235,245,.45);--bc:rgba(235,235,245,.42);}
/* charge-now: a soft static gold glow behind the car icon (feathered to nothing, no pulse) */
#cCar .cc-car.st-now .cc-ic::before{content:"";position:absolute;inset:-9px;border-radius:50%;z-index:-1;pointer-events:none;
  background:radial-gradient(closest-side,rgba(255,214,10,.30),rgba(255,214,10,.10) 62%,rgba(255,214,10,0) 100%);}
#cCar .cc-car.st-now .cc-ic{color:var(--yellow);}
#cCar .cc-ft{display:flex;justify-content:space-between;align-items:baseline;gap:10px;white-space:nowrap;margin-top:1px;}
#cCar .cc-ft span{font:500 16px/1.1 var(--sf);color:rgba(245,245,247,.74);}
#cCar .cc-ft span.sg{font:700 21px/1 var(--sf);letter-spacing:.03em;color:#fff;flex:none;}
`;
  document.head.appendChild(css);

  const C = { _v: 1, st: { cars: [], station: null }, errs: [] };
  const pt = (iso, o) => new Date(iso).toLocaleString('en-US', Object.assign({ timeZone: TZ }, o));
  const nbu = s => String(s).replace(/ (AM|PM|mi|kWh)\b/g, NB + '$1').replace(/\best\. \$/g, 'est.' + NB + '$').replace(/\b(Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct) (\d)/g, '$1' + NB + '$2');
  function tm(iso, keepZero) { const m = +pt(iso, { minute: 'numeric' });
    return nbu(pt(iso, { hour: 'numeric', minute: (m || keepZero) ? '2-digit' : undefined }).replace(/ /g, ' ')); }
  const mdt = iso => nbu(pt(iso, { month: 'short', day: 'numeric' }));
  const money = n => '$' + Number(n).toFixed(2);

  function carState(r, st, nowMs) {
    const est = r.est_cost != null ? 'est. ' + money(r.est_cost) : '';
    if (r.sweep && r.sweep.move_by) return { k: 'sweep', icon: 1, a: 'Move by ' + nbu(r.sweep.move_by), b: 'street sweeping' };
    if (r.stale || r.status === 'stale') return { k: 'stale', a: 'Last seen ' + (r.data_at ? tm(r.data_at, true) : 'a while ago'), b: '' };
    if (r.status === 'away') return { k: 'trip', a: 'On a trip', b: r.trip_end ? 'back ' + mdt(r.trip_end) + ', ' + tm(r.trip_end) : '' };
    if (r.status === 'wont_make') return { k: 'wont', icon: 1, a: 'Won’t be ready', b: 'for ' + tm(r.next_trip_at, true) + ' trip' };
    const free = st && st.ports_free > 0;
    const inWin = r.plan_start && nowMs >= Date.parse(r.plan_start) && nowMs <= Date.parse(r.plan_end);
    const now = r.charge_now != null ? r.charge_now : (r.home && !r.plugged_in && r.soc < (r.target_pct || 80) && free && inWin);
    if (r.status === 'charging' || r.charging_state === 'Charging')
      return { k: 'charge', a: 'Charging · full ' + tm(r.plan_end), b: nbu(est), c: 'Full ' + tm(r.plan_end) + (est ? ' · ' + nbu(est) : '') };
    if (now) return { k: 'now', a: 'Blake charger free', b: 'charge now' };
    if (r.status === 'ready') return { k: 'plan', a: 'Ready for the next trip', b: '' };
    if (r.plan_start) return { k: 'plan', a: 'Charge ' + tm(r.plan_start) + ' to ' + tm(r.plan_end), b: nbu(est), c: tm(r.plan_start) + ' to ' + tm(r.plan_end) + (est ? ' · ' + nbu(est) : '') };
    return { k: 'plan', a: 'No charge needed', b: '' };
  }
  const TINT = { 'Blue Steel': '#8FB6E8' };      // car color tint when known; neutral otherwise

  function ensure() {
    let a = document.getElementById('cCar'); if (a) return a;
    const cards = document.getElementById('cards'), t = document.getElementById('cTuro'); if (!cards) return null;
    a = document.createElement('article'); a.className = 'card'; a.id = 'cCar';
    a.innerHTML = '<div class="hdr r" style="--i:0;color:var(--green)"><svg class="sym" viewBox="0 0 24 24"><use href="#i-car"/></svg><span class="app">Cars</span><span class="meta num" id="ccMeta"></span></div>' +
      '<div class="rings cc-wrap r" style="--i:1"><div class="cc-list" id="ccList"></div><div class="cc-ft" id="ccFt"></div></div>';
    cards.insertBefore(a, t ? t.nextSibling : null); return a;
  }
  const over = el => el.scrollWidth > el.clientWidth + 0.5;
  function fit(el, min) { let z = parseFloat(getComputedStyle(el).fontSize); while (over(el) && z > min) { z -= .5; el.style.fontSize = z + 'px'; } return !over(el); }

  C.render = function () {
    try {
      const d = C.st, cars = (d.cars || []).slice(0, 3); if (!cars.length) return;
      const card = ensure(); const L = document.getElementById('ccList'), n = cars.length, nowMs = Date.now();
      L.className = 'cc-list d' + n; L.style.zoom = '';
      L.innerHTML = cars.map(r => {
        const s = carState(r, d.station, nowMs), tint = TINT[r.car] || 'rgba(235,235,245,.82)';
        const lead = s.icon ? '<svg class="sym" viewBox="0 0 24 24"><use href="#i-warn"/></svg>' : '<b></b>';
        const bar = n === 1 ? `<div class="cc-bar"><i style="width:${Math.max(2, Math.min(100, r.soc))}%"></i><u style="left:${r.target_pct || 80}%"></u></div>` : '';
        const one = s.a + (s.b ? ' · ' + s.b : '');
        const tx = n === 3 ? `<span class="p1" data-c="${s.c || ''}">${one}</span>` : `<span class="p1">${s.a}</span>${s.b ? `<span class="p2">${s.b}</span>` : ''}`;
        return `<div class="cc-car st-${s.k}" style="--tint:${tint}"><div class="cc-top"><div class="cc-ic"><svg class="sym" viewBox="0 0 24 24"><use href="#i-car"/></svg></div>` +
          `<div class="cc-nm">${r.car}</div><div class="cc-hero"><b class="num">${Math.round(r.soc)}<small>%</small></b><i class="num">${nbu(Math.round(r.range_mi) + ' mi')}</i></div></div>${bar}` +
          `<div class="cc-st"><span class="cc-sl">${lead}</span><div class="cc-tx">${tx}</div></div></div>`;
      }).join('');
      const r0 = cars[0], stn = d.station || {}, free = stn.ports_free != null ? `${stn.ports_free} of ${stn.ports_total} free` : (r0.charger_status || '');
      const price = r0.price_now != null ? r0.price_now : stn.price_now;
      document.getElementById('ccFt').innerHTML = `<span>Blake charger · ${free}</span><span class="sg">Mae</span>`;
      document.getElementById('ccMeta').textContent = price != null ? '$' + Number(price).toFixed(2) + '/kWh' + NB + 'now' : '';
      // fit: shrink to a floor, then compact wording (3 cars), then wrap whole words; never clip, never "..."
      L.querySelectorAll('.cc-nm').forEach(e => { e.style.whiteSpace = 'nowrap'; if (!fit(e, 16)) { e.style.whiteSpace = 'normal'; } });
      L.querySelectorAll('.cc-tx .p1, .cc-tx .p2').forEach(e => {
        if (e.dataset.c && over(e)) { e.textContent = e.dataset.c; }
        if (!fit(e, n === 1 ? 17 : 14.5)) { e.style.whiteSpace = 'normal'; } });
      fit(document.getElementById('ccFt').firstChild, 14);
      const room = card.clientHeight - card.querySelector('.hdr').offsetHeight - 9 - 9 - 20;
      if (L.scrollHeight > room) L.style.zoom = (room / L.scrollHeight).toFixed(3);
    } catch (e) { C.errs.push(String(e && e.message || e)); }
  };
  C.feed = function (d) { C.st = d; C.render(); return { cars: d.cars.length, errs: C.errs.slice(-2) }; };

  // preview only: pin this page on (the real wall rotation timer lives inside the page's closure, so hold the class on) and mark its pager dot
  C.show = function () {
    const cards = document.getElementById('cards'), pg = document.getElementById('pager'); let busy = false;
    const apply = () => { if (busy) return; busy = true;
      cards.querySelectorAll('.card').forEach(c => { const on = c.id === 'cCar'; if (c.classList.contains('on') !== on) c.classList.toggle('on', on); });
      if (pg) { if (!pg.dataset.cc || pg.children.length !== (+pg.dataset.cc) + 1) { pg.dataset.cc = pg.children.length; pg.appendChild(document.createElement('i')); }
        [...pg.children].forEach((d, i) => { const on = i === 1; if (d.classList.contains('on') !== on) d.classList.toggle('on', on); }); }
      busy = false; };
    if (C._o) C._o.disconnect(); C._o = new MutationObserver(apply); apply();
    C._o.observe(cards, { subtree: true, attributes: true, attributeFilter: ['class'] }); if (pg) C._o.observe(pg, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    return 'shown';
  };
  window.CARCARD = C; return 'ok';
})();
