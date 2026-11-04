/* ASK-THE-WALL answer card, PREVIEW prototype (2026-11-03). NOT in the live wall.html: injected into a separate test tab by tab2.mjs.
   Sits in the center-right rotating card slot (.rightp/.cards, 410 x 216 stage px) exactly like CARCARD: article.card, .hdr + .sym + .app, .r rise-in.
   Question small (quoted, secondary), answer big (SF 600, shrinks to a floor then wraps whole words, never clipped, no ellipsis), up to 3 detail lines.
   Column is 280 px wide on purpose (TV-shadow mask slants across this slot); wrapper carries class "rings" so the wall's avoidMask() zooms it instead of clipping.
   Subject ring: a feathered soft ring (radial gradient, no hard edge) appended inside the subject plane's .ac element so it follows the plane; real wall maps hex -> AIRS[hex].el.
   Shows ~20 s (ttl_s), then the card and ring fade out (opacity ease, feathered ring). Nothing else animates.
   Data = wall_questions row: {question, answer_text, answer_card:{title,lines[],subject?{type,id},ttl_s}}. */
(function(){
  if (window.ASKCARD && window.ASKCARD._v) return 'already';
  const NB = ' ';
  const css = document.createElement('style'); css.id = 'askcss';
  css.textContent = `
#cAsk{--W:280px;gap:0;}
#cAsk .hdr{width:var(--W);}
#cAsk .hdr .meta{font:600 19px/1 var(--sf);letter-spacing:-.005em;color:rgba(245,245,247,.74);white-space:nowrap;}
#cAsk .as-wrap.rings{display:flex;flex-direction:column;gap:7px;width:var(--W);margin-top:8px;align-items:stretch;transform-origin:0 0;}
#cAsk .as-q{font:500 16px/1.2 var(--sf);letter-spacing:-.005em;color:rgba(245,245,247,.62);font-style:italic;}
#cAsk .as-a{font:700 31px/1.08 var(--sf);letter-spacing:-.02em;color:#fff;overflow-wrap:normal;}
#cAsk .as-l{display:flex;flex-direction:column;gap:2px;margin-top:2px;}
#cAsk .as-l span{font:500 16px/1.2 var(--sf);letter-spacing:-.005em;color:rgba(245,245,247,.78);}
#cAsk{transition:opacity .9s ease;}
#cAsk.as-out{opacity:0;}
.ac .askring{position:absolute;left:50%;top:50%;width:92px;height:92px;margin:-46px 0 0 -46px;border-radius:50%;pointer-events:none;z-index:3;opacity:0;transition:opacity .9s ease;
  background:radial-gradient(closest-side,rgba(10,132,255,0) 52%,rgba(10,132,255,.55) 68%,rgba(10,132,255,.22) 82%,rgba(10,132,255,0) 100%);}
.ac .askring.on{opacity:1;}
`;
  document.head.appendChild(css);

  const A = { _v: 1, errs: [], t: null };
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const nbu = s => String(s).replace(/ (AM|PM|mi|ft|feet|miles|mph|minutes?|degrees)\b/g, NB + '$1');
  const clock = () => new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).replace(/ /g, NB);

  function ensure() {
    const cards = document.getElementById('cards'); let el = document.getElementById('cAsk');
    if (!el) {
      el = document.createElement('article'); el.className = 'card'; el.id = 'cAsk';
      el.innerHTML = '<div class="hdr r" style="--i:0;color:var(--blue)"><svg class="sym" viewBox="0 0 24 24"><path fill="currentColor" d="M12 15.2a3.2 3.2 0 0 0 3.2-3.2V6.2a3.2 3.2 0 0 0-6.4 0V12a3.2 3.2 0 0 0 3.2 3.2Zm5.6-3.4a.9.9 0 0 0-1.8 0 3.8 3.8 0 0 1-7.6 0 .9.9 0 0 0-1.8 0 5.6 5.6 0 0 0 4.7 5.5v1.7H9.9a.9.9 0 0 0 0 1.8h4.2a.9.9 0 0 0 0-1.8h-1.6v-1.7a5.6 5.6 0 0 0 5.1-5.5Z"/></svg><span class="app">Ask the wall</span><span class="meta num" id="asMeta"></span></div>' +
        '<div class="as-wrap rings r" style="--i:1"><div class="as-q" id="asQ"></div><div class="as-a" id="asA"></div><div class="as-l" id="asL"></div></div>';
      cards.appendChild(el);
    }
    return el;
  }
  function fitAnswer(el, wrap, card) {
    let fs = 31; el.style.fontSize = fs + 'px';
    const room = card.clientHeight - card.querySelector('.hdr').offsetHeight - 8 - 8 - (document.getElementById('asQ').offsetHeight + 7) - (document.getElementById('asL').offsetHeight + 7);
    while (el.scrollHeight > room && fs > 19) { fs -= 1; el.style.fontSize = fs + 'px'; }
    // still too tall at the floor: drop detail lines before ever clipping the answer
    if (el.scrollHeight > room) document.getElementById('asL').style.display = 'none';
  }
  function ring(subject, on) {
    document.querySelectorAll('.ac .askring').forEach(r => { r.classList.remove('on'); setTimeout(() => r.remove(), 1000); });
    if (!on || !subject) return 'no-ring';
    const pick = window.__askPick ? window.__askPick(subject) : document.querySelector('.ac');
    if (!pick) return 'no-plane-on-sky';
    const r = document.createElement('i'); r.className = 'askring'; pick.appendChild(r); requestAnimationFrame(() => r.classList.add('on'));
    return 'ring';
  }
  A.render = function (row) {
    try {
      const card = ensure(), c = row.answer_card || {}, lines = (c.lines || []).slice(0, 3);
      document.getElementById('asMeta').textContent = clock();
      document.getElementById('asQ').textContent = '“' + row.question + '”';
      document.getElementById('asA').innerHTML = nbu(esc(row.answer_text));
      document.getElementById('asL').style.display = '';
      document.getElementById('asL').innerHTML = lines.map(l => '<span>' + nbu(esc(l)) + '</span>').join('');
      card.classList.remove('as-out');
      fitAnswer(document.getElementById('asA'), card.querySelector('.as-wrap'), card);
      return ring(c.subject, true);
    } catch (e) { A.errs.push(String(e && e.message || e)); return 'err ' + A.errs.slice(-1); }
  };
  // preview: pin the page on (the real rotation timer lives in the page closure), fade after ttl
  A.show = function (row, ttl) {
    const cards = document.getElementById('cards'); let busy = false;
    const res = A.render(row);
    const apply = () => { if (busy) return; busy = true; cards.querySelectorAll('.card').forEach(c => { const on = c.id === 'cAsk'; if (c.classList.contains('on') !== on) c.classList.toggle('on', on); }); busy = false; };
    if (A._o) A._o.disconnect(); A._o = new MutationObserver(apply); apply(); A._o.observe(cards, { subtree: true, attributes: true, attributeFilter: ['class'] });
    clearTimeout(A.t);
    A.t = setTimeout(() => { document.getElementById('cAsk').classList.add('as-out'); ring(null, false); setTimeout(() => A._o && A._o.disconnect(), 1000); },
      ((ttl || (row.answer_card && row.answer_card.ttl_s) || 20)) * 1000);
    return res;
  };
  window.ASKCARD = A; return 'ok';
})();
