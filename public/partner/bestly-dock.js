/* Bestly call dock. Copied verbatim from the Studio build 1808ea1d (index.e160b385f9.html, the dock IIFE only; r11: one seat at a time).
   To re-sync after a Studio change, copy that block here again. Host wiring lives in src/pages/partner/useCallDock.ts.
   ONE local change (line marked PORTAL): "We do not message Elizabeth" names cfg.waitFor() instead. Re-apply it after a re-sync.
   Loaded once by the partner portal; plain ES2020, appends #bdock to document.body. */

/* ══ Bestly call dock ═══════════════════════════════════════════════════════
   One floating call window, shared by her board and Studio. Mounted once at
   the page root and never re-rendered: tab changes, repaints and screen changes
   cannot touch it, so a call survives them. The call itself is the Bestly Cloud
   Talk page in an iframe; this file draws everything around it and drives it
   over the bridge:
     parent -> frame  { type:"bestly-call", cmd:"mute|unmute|camera-on|camera-off|share-start|share-stop|leave|join" }
     frame -> parent  { type:"bestly-call-state", joined, muted, camera, sharing:null|{by,me}, people:[{name,speaking}], error? }
   The frame's FIRST message may be a hello, { joined:false, loading:true, hello:true } with no muted and no camera:
   it only says "alive, still loading" (round 3). muted and camera are read only from a message that says joined:true.
   A cold join takes 16 to 33 s (Bestly Cloud on a Pi), so the dock waits long (see T below), says "Joining your call" with
   a soft pulsing dot, and shows a dark "Joining your call" placeholder over the frame until the frame says anything.
   Pre-warm (cfg.prewarm, on unless it says false): when the pre-join check opens, the ticket is fetched and the call
   frame loads behind the pre-join card; the Join tap reuses that frame and sends join at once. Closing the pre-join
   check tears the frame down; if the frame fails first, the tap does what it always did (ticket, frame, join).
   cfg.onChange(joined) is called when she joins or leaves; cfg.onConnect(connecting) when the call starts or restarts
   for her, so the host's own pill or button can say "Joining your call" too (no minutes, not "In the call" yet).
   cfg.onFail(failed) (round 3, N9): true when the dock has given up on the join (not signed in to Bestly Cloud, a frame that stays silent,
   a join the frame ignores), false again when the call starts after all, she taps Try again, or she leaves. The host's pill or button
   must then stop saying she is in the call: it says "Join the call" while a call is live, and nothing while none is.
   Sign-in (round 3, N12): "Sign in to Bestly Cloud" moves the call frame itself to Bestly Cloud's sign-in page (redirect_url = the call page), never a new tab (a Safari
   web app sends other sites to Safari). Bestly Cloud sends the frame back into the call, and the frame's first message restarts the join; "I have signed in" reloads the call page by hand.
   Fallbacks: a silent bridge shows Talk's own buttons inside the frame; a frame that
   will not load shows "Open the call in its own tab" with a fresh ticket. Every fault
   goes to cfg.fault (Studio Watch). Position and size are remembered per viewer.
   Round 5 (frame bridge v5, the frame URL carries bv=5): the PAGE never captures the camera. Tapping Join opens this window at once and sends
   cmd "preview"; the frame opens its own self view (the one and only capture, so the browser's question shows right away, on an iPhone too),
   the window shows it with "Join now", and Join sends cmd "join" with the devices already open. The frame says phase / perm / preview / ready / others
   (see noteV5). A frame that answers without bv (an older theme) keeps the round 4 way (D.legacy). The header says "In the lobby" while connecting and
   "Waiting for <cfg.waitFor>" while nobody else is in; the frame is never hidden, parked off screen or 0x0 while a call is live (a small window and a bar show it live).
   While a call is live the page does not leave: a link that would replace the page opens in a new tab, and a reload asks first (armNav).
   The window's place is published (BestlyDock.lift / onGeom) so a host's toasts stay clear of it.
   Messages (round 3, N8 and N10): the chat never covers the people. On a desktop or a tablet it is a panel BESIDE the call window, as tall as the
   screen (16 px in at the top and the bottom, below the board's top bar), on the side of the window that has room; the window keeps its size and its
   spot. The panel's free edge is a handle: drag it, or use the left and right arrow keys, to change the width (300 px at the least, half the screen
   or 640 px at the most; a double-click, or Enter, sets it back to 340 px). On a phone, and on a narrow screen, the video becomes a strip on top
   with the chat under it, and the divider between them is a handle too (the strip is 120 px to half the screen; the "Bigger chat" grip, or a
   double-tap on the divider, snaps it to its least). While someone shares a screen the chat is a panel on the stage's right edge, also
   resizable, and the shared screen fits beside it. Both sizes are remembered per viewer (KEY2). The title is always cfg.title ("Strategy call");
   the status line carries the state. */
(function(){
  if(window.BestlyDock) return;
  const NB = " ", KEY = "bestly.dock.v1";
  const SPOTS = ["tl", "ml", "bl", "tr", "mr", "br"];
  const GAP = 16, RANGE = 140, MOMENTUM = 499;
  const CW = 340, STAGE_MIN = 560;      /* Messages: the side panel's usual width, and the least width the shared screen keeps beside it */
  const CW_MIN = 300, CW_MAX = 640, PG = 12;      /* N10: the panel is never narrower than 300 px nor wider than 640 px (or half the screen); 12 px of board between it and the window */
  const STRIP_MIN = 120, KEY2 = "bestly.dock.chat.v1";      /* N10: on a phone the video strip is never less than 120 px (nor more than half the screen); where the two sizes are remembered */
  const ALLOW = "camera; microphone; display-capture; autoplay; fullscreen; screen-wake-lock";
  /* round 5: the behavior level this page speaks. The call page only does its new things when its address says bv=5 (or more). */
  const BV = 5;
  const withBv = (u) => { try { const x = new URL(u, location.href); x.searchParams.set("bv", String(BV)); return x.href; } catch { return String(u) + (String(u).indexOf("?") < 0 ? "?" : "&") + "bv=" + BV; } };
  /* how long the dock is patient, in ms. bridge: how long a frame may say nothing before Talk's own buttons are shown;
     give: how long the join is repeated before giving up; ping: the gap between two joins; warmTtl: how long a pre-warmed
     frame is kept while the pre-join check stays open; warmMin: the least patience left for a pre-warmed frame at the tap.
     (BestlyDock._T lets a test shorten them.) */
  const T = { bridge: 35000, give: 45000, ping: 1000, warmTtl: 10 * 60 * 1000, warmMin: 8000 };
  const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  /* faces (round 3): the host says who a person on the call is (cfg.face) and who you are (cfg.me); the picture
     comes from BestlyFaces. Nobody with no picture changes: they keep the letter. */
  const faceOf = (p) => { try { return D.cfg && D.cfg.face && window.BestlyFaces ? (D.cfg.face(p) || null) : null; } catch(e) { return null; } };
  const putFace = (el, key, name) => { const letter = String(name || "").trim().charAt(0).toUpperCase() || "·"; if(window.BestlyFaces) window.BestlyFaces.put(el, key, letter); else el.textContent = letter; };
  const ICON = {
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>',
    micoff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4l16 16"/><path d="M9 9v2a3 3 0 005 2M15 10V6a3 3 0 00-5.6-1.5"/><path d="M5 11a7 7 0 0011 5.7M12 18v3"/></svg>',
    cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="12" height="12" rx="3"/><path d="M15 10l6-3v10l-6-3"/></svg>',
    camoff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4l16 16"/><path d="M9 6h3a3 3 0 013 3v3M15 15v0a3 3 0 01-3 3H6a3 3 0 01-3-3V9a3 3 0 011-2"/><path d="M15 10l6-3v10l-3-1.5"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M12 12V8M9.5 10L12 7.5 14.5 10"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 01-11.6 7.1L4 20l1-4A8 8 0 1120 12z"/></svg>',
    leave: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path transform="translate(0 -.76)" d="M12 9c-3.4 0-6.500 1.100-8.800 3.100-.6.500-.7 1.300-.3 1.900l1.100 1.800c.4.600 1.100.9 1.800.6l2.300-.9c.6-.2 1-.8 1-1.400v-1.200c1.700-.6 3.900-.6 5.800 0v1.200c0 .6.400 1.200 1 1.400l2.300.9c.7.300 1.400 0 1.800-.6l1.100-1.800c.4-.6.300-1.400-.3-1.900C18.500 10.100 15.400 9 12 9z"/></svg>',
    big: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
    small: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>',
    shrink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14l-6 6M4 15v5h5M14 10l6-6M20 9V4h-5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    grip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/></svg>',
  };
  // Scout's notetaker joins calls but is not a person on the call: never a tile, a speaker or a head-count
  const isScout = (p) => !!p && /scout|notetaker/i.test([p.name, p.id, p.uid, p.user, p.displayName].filter(Boolean).join(" "));
  /* How long the call has been going, in words. The first minute reads "just started", never "0 min" or "0 minutes"; the number is glued
     to its unit. Every place that shows minutes uses these two (the board's call pill and Studio's call button too). */
  const minShort = (n) => n < 1 ? "just started" : `${n}${NB}min`;
  const minLong = (n) => n < 1 ? "just started" : `${n}${NB}${n === 1 ? "minute" : "minutes"}`;
  const BINOS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6.5" cy="16" r="3.5"/><circle cx="17.5" cy="16" r="3.5"/><path d="M10 16h4M6.5 12.5V6.5A1.5 1.5 0 018 5h1.5a1 1 0 011 1v6M17.5 12.5V6.5A1.5 1.5 0 0016 5h-1.5a1 1 0 00-1 1v6"/></svg>';
  const D = {
    cfg: null, root: null, el: {},
    st: { scout: false, open: false, mode: "prejoin", joined: false, muted: false, camera: true, sharing: null, people: [], error: "", chatOpen: false, unread: 0, stageOff: false, joinedAt: 0, bridge: "wait", full: false },
    pos: { spot: "br", x: 0, y: 0, size: "normal" },
    pre: { stream: null, mic: true, cam: true, ctx: null, raf: 0, state: "idle" },
    frame: null, origin: "", chat: { last: 0, run: false, msgs: [], seen: 0, stick: true, loaded: false, ch: 0 },
    dfull: false, side: "r", login: false, signing: false, signLoads: 0, signT: 0, callUrl: "", glide: 0, gy: null,       /* Messages: which side of the call window the panel is on (r or l) */
    /* N10: cw = the panel width she chose (px), strip = the video strip she chose (a share of the screen height, or null), eff = the width on the screen now, max = the widest it may be here,
       sp = the running spring, back = the strip before "Bigger chat" */
    sz: { cw: CW, strip: null, eff: CW, max: CW_MAX, sp: 0, back: 0, t: 0 },
    /* the pre-warmed call frame: idle | ticket (asking for the ticket) | loading (the frame is on its way) | failed */
    warm: { state: "idle", id: 0, f: null, t0: 0, loaded: false, alive: false, p: null }, pingT0: 0,
    /* round 5: what the v5 frame last said about itself. mode: pending (not heard yet), v5, or legacy (an older frame: the round 4 way) */
    v5: { mode: "pending", bv: 0, phase: "", perm: "", preview: false, ready: false, others: 0, lobbyText: "", slow: false, joining: false, asked: false },
    legacy: false, lobbyT0: 0,
    timers: {},
  };
  const freshV5 = (mode) => ({ mode: mode || "pending", bv: 0, phase: "", perm: "", preview: false, ready: false, others: 0, lobbyText: "", slow: false, joining: false, asked: false });

  /* ── per-viewer memory ─────────────────────────────────────────────── */
  const load = () => { try { const j = JSON.parse(localStorage.getItem(KEY) || "null"); if(j && typeof j === "object"){ if(SPOTS.includes(j.spot) || j.spot === null) D.pos.spot = j.spot; if(isFinite(j.x)) D.pos.x = +j.x; if(isFinite(j.y)) D.pos.y = +j.y; if(j.size === "big" || j.size === "normal") D.pos.size = j.size; } } catch {} };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ spot: D.pos.spot, x: Math.round(D.pos.x), y: Math.round(D.pos.y), size: D.pos.size })); } catch {} };
  const loadSz = () => { try { const j = JSON.parse(localStorage.getItem(KEY2) || "null"); if(j && typeof j === "object"){ if(isFinite(j.cw) && j.cw >= CW_MIN && j.cw <= CW_MAX) D.sz.cw = Math.round(+j.cw); if(isFinite(j.strip) && j.strip >= 0.05 && j.strip <= 0.6) D.sz.strip = +j.strip; } } catch {} };
  const saveSz = () => { try { localStorage.setItem(KEY2, JSON.stringify({ cw: Math.round(D.sz.cw), strip: D.sz.strip == null ? null : Math.round(D.sz.strip * 1000) / 1000 })); } catch {} };
  const fault = (code, detail) => { try { D.cfg && D.cfg.fault && D.cfg.fault(code, detail); } catch {} };
  const phaseIn = (ph) => /^(alone|connected|reconnecting|stage|call)$/.test(String(ph || ""));      /* the call page's phases that mean "in the call" (alone included); "lobby" and "preview" do not */
  const inCall = () => (!!D.frameJoined || (D.v5.mode === "v5" && phaseIn(D.v5.phase))) && !(D.v5.mode === "v5" && D.v5.perm === "prompt");      /* the frame says joined AND is not still asking for the camera: a call page can say joined in its lobby */
  const BUILD_LABEL = "r11-2026-10-29";      /* which build ran: the call window shows it tiny ("r5") and logs it (call_win_boot) */
  const phone = () => { try { return matchMedia("(max-width: 640px)").matches; } catch { return innerWidth <= 640; } };
  const isIphone = () => /iPhone|iPod/.test(navigator.userAgent || "");
  const isIOS = () => { try { return /iPhone|iPad|iPod/.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1); } catch { return false; } };
  /* Share is offered only where the browser can share a screen: not on an iPhone, and not on an iPad either (its Safari says "Macintosh"
     but cannot share a screen). A host can still say no with cfg.canShare === false. */
  const canShare = () => !isIphone() && !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !(D.cfg && D.cfg.canShare === false);

  const standalone = () => { try { return navigator.standalone === true || matchMedia("(display-mode: standalone)").matches; } catch { return false; } };
  /* round 5: is the v5 way (the call page opens the self view, this page never captures) in use? It needs the early frame, so no pre-warm means the old way. */
  const v5on = () => !D.legacy && !(D.cfg && D.cfg.v5 === false) && prewarmOn() && D.warm.state !== "failed";
  /* one plain line for a camera that was refused, by device */
  const denyWords = () => isIOS()
    ? (standalone() ? "Your phone said no to the camera. Open Settings, then Safari, then Camera and Microphone, and allow this site. Then tap Try again."
                    : "Your phone said no to the camera. Tap the aA button by the address, choose Website Settings, and allow Camera and Microphone. Then tap Try again.")
    : "Your browser said no to the camera. Click the camera icon by the address, choose Allow, then click Try again.";
  const waitFor = () => { try { const w = D.cfg && D.cfg.waitFor; return String(typeof w === "function" ? w() : (w || "")).trim(); } catch { return ""; } };
  const waitWords = () => { const n = waitFor(); return n ? `Waiting for ${n}` : "Waiting for the others"; };

  /* ── geometry: six spots, free placement, 16 px in ────────────────── */
  const padTop = () => GAP + (D.cfg && D.cfg.topInset ? D.cfg.topInset() : 0);
  const padBottom = () => GAP + (D.cfg && D.cfg.bottomInset ? D.cfg.bottomInset() : 0);
  const size = () => { const r = D.root.getBoundingClientRect(); return { w: r.width, h: r.height }; };
  const spotXY = (spot, w, h) => {
    const vw = innerWidth, vh = innerHeight, L = GAP, R = vw - w - GAP, T = padTop(), B = vh - h - padBottom(), M = Math.round((vh - h) / 2);
    const x = spot[1] === "l" || spot === "ml" ? L : R;
    const col = (spot === "tl" || spot === "ml" || spot === "bl") ? L : R;
    const y = spot[0] === "t" ? T : spot[0] === "b" ? B : M;
    return { x: Math.max(GAP, col), y: Math.max(T, Math.min(y, Math.max(T, B))) };
  };
  const clamp = (x, y, w, h) => ({
    x: Math.max(GAP, Math.min(x, Math.max(GAP, innerWidth - w - GAP))),
    y: Math.max(padTop(), Math.min(y, Math.max(padTop(), innerHeight - h - padBottom()))),
  });
  /* ── Messages beside the window (round 3, N10) ──────────────────────────────────────────────────────────────── */
  const leftSpot = (s) => s === "tl" || s === "ml" || s === "bl";
  const winW = () => Math.min(D.pos.size === "big" ? 640 : 380, Math.max(0, innerWidth - 2 * GAP));
  /* The tall panel stands next to the window and is the window's child, so it rides along with it. --bd-pt takes the window's own offset back out
     (the panel's top is always the screen's top inset) and --bd-ph is the height between the insets: the panel itself never moves up or down. */
  const isSide = () => { const d = D.root && D.root.dataset; return !!d && d.chat === "1" && (d.cpos === "r" || d.cpos === "l") && d.mode !== "stage"; };
  /* the panel changes sides while the window travels across the screen: it stays out of sight on the way and arrives beside the window with its usual entrance (see followSpot) */
  const unflip = () => { clearTimeout(D.flipT); if(D.root) D.root.classList.remove("bd-flip"); };
  const paintSide = (y) => {
    if(!isSide()) return;
    const yy = y != null ? y : (D.glide && D.gy != null ? D.gy : Math.round(D.cur ? D.cur.y : 0));      // mid-glide the window is not yet where D.cur says it will be
    let top = padTop(), bot = innerHeight - padBottom();
    const vv = window.visualViewport;
    if(vv && touchy() && innerHeight - vv.height > 120){ top = Math.max(top, Math.round(vv.offsetTop) + GAP / 2); bot = Math.min(bot, Math.round(vv.offsetTop + vv.height) - GAP / 2); }      // a tablet's on-screen keys: the message box stays above them
    D.root.style.setProperty("--bd-pt", Math.round(top - yy) + "px");
    D.root.style.setProperty("--bd-ph", Math.max(240, Math.round(bot - top)) + "px");
  };
  /* cubic-bezier(.2,.8,.2,1): the window's own glide, for when the script has to move the window and the panel in the same frame */
  const bez = (x1, y1, x2, y2) => (t) => {
    let u = t;
    for(let i = 0; i < 8; i++){
      const a = 1 - u, x = 3 * a * a * u * x1 + 3 * a * u * u * x2 + u * u * u - t, dx = 3 * a * a * x1 + 6 * a * u * (x2 - x1) + 3 * u * u * (1 - x2);
      if(Math.abs(x) < 1e-5 || !dx) break;
      u = Math.min(1, Math.max(0, u - x / dx));
    }
    const a = 1 - u; return 3 * a * a * u * y1 + 3 * a * u * u * y2 + u * u * u;
  };
  const GLIDE = bez(.2, .8, .2, 1);
  const glide = (a, b) => {
    const root = D.root, t0 = performance.now();
    root.style.transition = "none"; D.gy = Math.round(a.y);
    const step = (now) => {
      const k = Math.min(1, Math.max(0, (now - t0) / 260)), e = k >= 1 ? 1 : GLIDE(k);
      const x = Math.round(a.x + (b.x - a.x) * e), y = Math.round(a.y + (b.y - a.y) * e);
      D.gy = y; root.style.transform = `translate3d(${x}px,${y}px,0)`; paintSide(y);
      D.glide = k < 1 ? requestAnimationFrame(step) : 0;
      if(k >= 1){ unflip(); geomPing(); }
    };
    D.glide = requestAnimationFrame(step);
  };
  /* round 5: where the window is, for the page around it. The host's toasts ask BestlyDock.lift() how far to rise to stay clear of it, and BestlyDock.onGeom() when it moves. */
  const geomSubs = [];
  const dockRect = () => {
    const r = D.root; if(!r || r.hidden || !D.st.open) return null;
    const b = r.getBoundingClientRect(); if(!b.width || !b.height) return null;
    let l = b.left, t = b.top, rr = b.right, bb = b.bottom;
    if(isSide() && D.el.chat && !D.el.chat.hidden){ const c = D.el.chat.getBoundingClientRect(); if(c.width){ l = Math.min(l, c.left); t = Math.min(t, c.top); rr = Math.max(rr, c.right); bb = Math.max(bb, c.bottom); } }
    return { left: l, top: t, right: rr, bottom: bb, full: r.dataset.full === "1" || r.dataset.mode === "stage" };
  };
  let gRaf = 0;
  const geomPing = () => {
    if(gRaf) return;
    gRaf = requestAnimationFrame(() => {
      gRaf = 0; const g = dockRect();
      try { document.documentElement.dataset.bd = g ? (g.full ? "full" : "win") : "off"; } catch {}
      geomSubs.forEach(fn => { try { fn(g); } catch {} });
    });
  };
  const place = (animate) => {
    const root = D.root; if(!root) return;
    const { w, h } = size();
    let p;
    if(D.pos.spot) p = spotXY(D.pos.spot, w, h); else p = clamp(D.pos.x, D.pos.y, w, h);
    cancelAnimationFrame(D.glide); D.glide = 0;
    const from = D.cur, anim = animate && !reduced();
    // with the tall panel beside it the window glides by script (the same 260 ms curve), so the panel can stay still on the screen while the window moves
    if(anim && from && isSide() && (Math.round(from.x) !== Math.round(p.x) || Math.round(from.y) !== Math.round(p.y))){ D.cur = p; glide(from, p); return; }
    root.style.transition = anim ? "transform 260ms cubic-bezier(.2,.8,.2,1)" : "none";
    root.style.transform = `translate3d(${Math.round(p.x)}px,${Math.round(p.y)}px,0)`;
    D.cur = p; paintSide(); unflip(); geomPing();
  };
  const nearestSpot = (px, py, w, h, limit) => {
    let best = null, bd = Infinity;
    SPOTS.forEach(s => { const q = spotXY(s, w, h), d = Math.hypot(q.x - px, q.y - py); if(d < bd){ bd = d; best = s; } });
    return bd <= limit ? best : null;
  };
  /* Which way Messages is laid out, and how wide it may be:  r / l  a panel beside the call window (on the stage: on its right edge)  or  b  a strip of video with
     the chat under it. The panel stands on the side of the window that has room (at a spot: away from the screen's edge the window is at); it needs 300 px at the
     least, and may be half the screen or 640 px at the most. The window is never moved or resized for it. */
  const chatPlan = (mode, full) => {
    const vw = innerWidth, half = Math.floor(vw / 2);
    if(mode === "stage"){ const mx = Math.min(CW_MAX, half, vw - STAGE_MIN); return mx >= CW_MIN ? { cpos: "r", max: mx } : { cpos: "b" }; }      // the shared screen keeps at least 560 px
    if(full) return { cpos: "b" };                                                                                                             // a phone, the whole screen
    const w = winW(), h = size().h || 0, x = (D.pos.spot ? spotXY(D.pos.spot, w, h) : clamp(D.pos.x, D.pos.y, w, h)).x;
    const lim = (s) => Math.min(CW_MAX, half, Math.floor(s === "r" ? vw - GAP - (x + w) - PG : x - GAP - PG));
    let side;
    if(D.pos.spot) side = leftSpot(D.pos.spot) ? "r" : "l";
    else side = (lim("r") >= CW_MIN && lim("l") >= CW_MIN) ? (x + w / 2 > vw / 2 ? "l" : "r") : (lim("r") >= lim("l") ? "r" : "l");
    return lim(side) >= CW_MIN ? { cpos: side, max: lim(side) } : { cpos: "b" };
  };
  /* Messages is open and the window moved: the layout is chosen again for where it is now (the side may flip, or neither side has room) */
  const followSpot = () => {
    const r = D.root;
    if(!(D.st.chatOpen && D.st.joined) || r.dataset.chat !== "1" || r.dataset.mode !== "call") return;
    const was = r.dataset.cpos, plan = chatPlan("call", r.dataset.full === "1");
    r.dataset.cpos = plan.cpos; if(plan.cpos !== "b"){ D.side = plan.cpos; D.sz.max = plan.max; }
    if(!reduced() && ((was === "l" && plan.cpos === "r") || (was === "r" && plan.cpos === "l"))){ r.classList.add("bd-flip"); clearTimeout(D.flipT); D.flipT = setTimeout(unflip, 700); }      // the other side of the window: hidden on the way, there on arrival
    paintSz();
  };
  const moveSpot = (dir) => {
    const { w, h } = size();
    const cur = D.pos.spot || nearestSpot(D.cur ? D.cur.x : 0, D.cur ? D.cur.y : 0, w, h, Infinity) || "br";
    let col = (cur === "tl" || cur === "ml" || cur === "bl") ? "l" : "r", row = cur[0] === "t" ? 0 : cur[0] === "b" ? 2 : 1;
    if(dir === "ArrowLeft") col = "l"; else if(dir === "ArrowRight") col = "r";
    else if(dir === "ArrowUp") row = Math.max(0, row - 1); else if(dir === "ArrowDown") row = Math.min(2, row + 1);
    const rows = ["t", "m", "b"];
    // the four corners and the two middles: the middle row has no spot of its own at either side of the other column's corners
    D.pos.spot = rows[row] === "m" ? (col === "l" ? "ml" : "mr") : rows[row] + col;
    followSpot(); save(); place(true); say(`The call window moved to the ${({ t: "top", m: "middle", b: "bottom" })[rows[row]]} ${col === "l" ? "left" : "right"}.`);
  };
  const say = (t) => { const e = D.el.live; if(e){ e.textContent = ""; setTimeout(() => { e.textContent = t; }, 30); } };

  /* ── drag, with momentum ─────────────────────────────────────────── */
  const wireDrag = () => {
    attach(D.el.head); attach(D.el.tile); attach(D.el.popbar); addEventListener("resize", () => { if(D.st.open){ if(D.st.chatOpen && D.st.joined) applyChrome(); else place(false); } });
    // the keyboard on a phone changes the visual screen, not the page: the window follows it, so the message box is never behind the keys
    if(window.visualViewport){ visualViewport.addEventListener("resize", () => syncVV()); visualViewport.addEventListener("scroll", () => syncVV()); }
    // when the window itself grows or shrinks (the note that Scout is taking notes appears, a warning opens, the chat opens), it
    // is placed again, so a window parked at the bottom never hangs off the bottom of the screen
    if(window.ResizeObserver){
      new ResizeObserver(() => fitFrame()).observe(D.el.frameBox);      /* the call window grew, shrank or was shown: the call page is fitted again */
      let raf = 0, last = "";
      new ResizeObserver(() => {
        if(!D.st.open || D.root.classList.contains("dragging")) return;
        const r = D.root.getBoundingClientRect(), k = Math.round(r.width) + "x" + Math.round(r.height);
        if(k === last) return; last = k;
        /* the window has a new size: the status line is fitted again (a wider window has room for the longer wording), and the window is put back at its spot */
        cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if(D.st.joined) paintHead(); else settle(); });
      }).observe(D.root);
      /* the title bar itself is wider or narrower (Messages beside a shared screen was made wider or narrower): the status line is fitted again */
      let hw = 0, hraf = 0;
      new ResizeObserver(() => { const w = Math.round(D.el.head.getBoundingClientRect().width); if(w === hw) return; hw = w; cancelAnimationFrame(hraf); hraf = requestAnimationFrame(() => { if(D.st.joined && D.st.open) paintHead(); }); }).observe(D.el.head);
    }
  };
  const attach = (head) => {
    let drag = null;
    head.addEventListener("pointerdown", (e) => {
      if(e.button != null && e.button !== 0) return;
      if(e.target.closest("button,a,input,select")) return;
      if(D.st.mode === "stage" || D.root.dataset.full === "1") return;
      const { w, h } = size(), c = D.cur || { x: 0, y: 0 };
      D.tapOk = null;
      drag = { id: e.pointerId, ox: e.clientX - c.x, oy: e.clientY - c.y, w, h, s: [], moved: 0, sx: e.clientX, sy: e.clientY };
      try { head.setPointerCapture(e.pointerId); } catch {}
      cancelAnimationFrame(D.glide); D.glide = 0;
      D.root.classList.add("dragging"); D.root.style.transition = "none";
    });
    head.addEventListener("pointermove", (e) => {
      if(!drag || e.pointerId !== drag.id) return;
      const x = e.clientX - drag.ox, y = e.clientY - drag.oy;
      drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy));
      const now = performance.now(); drag.s.push({ t: now, x, y }); while(drag.s.length > 2 && now - drag.s[0].t > 90) drag.s.shift();
      const p = clamp(x, y, drag.w, drag.h);
      D.cur = p; D.pos.spot = null; D.pos.x = p.x; D.pos.y = p.y;
      D.root.style.transform = `translate3d(${Math.round(p.x)}px,${Math.round(p.y)}px,0)`; paintSide(Math.round(p.y)); geomPing();
    });
    const end = (e) => {
      if(!drag || (e && e.pointerId !== drag.id)) return;
      const d = drag; drag = null; D.root.classList.remove("dragging");
      try { head.releasePointerCapture(d.id); } catch {}
      const a = d.s[0], b = d.s[d.s.length - 1];
      let vx = 0, vy = 0;
      if(a && b && b.t > a.t && performance.now() - b.t < 100){ vx = (b.x - a.x) / (b.t - a.t); vy = (b.y - a.y) / (b.t - a.t); }
      // where it would stop if it kept gliding: the release point plus v * 499 (a 0.998 decay), in px per ms
      const px = D.cur.x + vx * MOMENTUM, py = D.cur.y + vy * MOMENTUM;
      const spot = nearestSpot(px, py, d.w, d.h, RANGE);
      if(spot){ D.pos.spot = spot; } else { const p = clamp(D.cur.x, D.cur.y, d.w, d.h); D.pos.spot = null; D.pos.x = p.x; D.pos.y = p.y; }
      followSpot(); save(); place(true);
      D.tapOk = d.moved < 6;
      if(d.moved < 6 && phone() && D.st.mode === "tile") expand();
    };
    head.addEventListener("pointerup", end); head.addEventListener("pointercancel", end);
    head.addEventListener("keydown", (e) => { if(/^Arrow(Left|Right|Up|Down)$/.test(e.key)){ e.preventDefault(); moveSpot(e.key); } });
  };

  /* ── the markup: built once ──────────────────────────────────────── */
  const build = () => {
    const r = document.createElement("div");
    r.id = "bdock"; r.hidden = true; r.setAttribute("role", "dialog"); r.setAttribute("aria-label", "Strategy call"); r.setAttribute("aria-modal", "false");
    r.dataset.mode = "prejoin"; r.dataset.size = "normal"; r.dataset.bridge = "wait";
    r.innerHTML = `
      <div class="bd-live" aria-live="polite" role="status"></div>
      <div class="bd-head" tabindex="0" role="group" aria-label="Call window. Drag to move it, or use the arrow keys to jump to another spot.">
        <span class="bd-grip">${ICON.grip}</span>
        <div class="bd-ht"><b class="bd-title">Strategy call</b><span class="bd-sub"><i class="bd-dot"></i><span class="bd-stat">Ready when you are</span></span></div>
        <span class="bd-notes" hidden><span class="bd-np">${BINOS}<span>Scout is taking notes</span></span></span>
        <button type="button" class="bd-ib bd-pop" aria-label="Pop out. Open the call in its own window." title="Pop out" hidden>${ICON.ext}</button>
        <button type="button" class="bd-ib bd-fill" aria-label="Fill the screen" hidden>${ICON.big}</button>
        <button type="button" class="bd-ib bd-fs" aria-label="Full screen" title="Full screen" hidden>${ICON.full}</button>
        <button type="button" class="bd-ib bd-big" aria-label="Make the window bigger">${ICON.big}</button>
        <button type="button" class="bd-ib bd-min" aria-label="Shrink the window to a bar">${ICON.small}</button>
        <button type="button" class="bd-ib bd-close" aria-label="Close this window">${ICON.close}</button>
        <button type="button" class="bd-pill bd-small" hidden>${ICON.shrink}<span>Make the window small</span></button>
      </div>
      <div class="bd-popbar" hidden tabindex="0" role="group" aria-label="Call in its own window. Drag to move it, or use the arrow keys to jump to another spot."><span class="bd-grip">${ICON.grip}</span><div class="bd-pbt"><i class="bd-dot"></i><span class="bd-pst"><span class="bd-pl on">Call in its own window</span><span class="bd-pl" aria-hidden="true"></span></span></div><button type="button" class="bd-pill bd-pshow">${ICON.ext}<span>Show it</span></button><button type="button" class="bd-pill bd-pback"><span>Bring it back</span></button></div>
      <div class="bd-tile" hidden tabindex="0" role="button" aria-label="Open the call full screen. Drag to move it, or use the arrow keys to jump to another spot."><span class="bd-tav"></span><span class="bd-tt"></span><span class="bd-tscout" hidden title="Scout is taking notes">${BINOS}</span></div>
      <div class="bd-body">
        <section class="bd-pre">
          <div class="bd-prev"><video playsinline muted autoplay></video><span class="bd-av">E</span><span class="bd-lab">Your camera</span><span class="bd-ok" hidden>${ICON.check}<span>Looks good</span></span></div>
          <div class="bd-mic"><span class="bd-micl">${ICON.mic}</span><span class="bd-mict">Checking your microphone</span><span class="bd-lvl"><i></i><i></i><i></i><i></i><i></i></span></div>
          <p class="bd-pnote" role="status" hidden></p>
          <div class="bd-tg"><button type="button" class="bd-t bd-pm" aria-pressed="true">${ICON.mic}<span>Microphone on</span></button><button type="button" class="bd-t bd-pc" aria-pressed="true">${ICON.cam}<span>Camera on</span></button></div>
          <button type="button" class="bd-pretry" hidden>${ICON.cam}<span>Try again</span></button>
          <button type="button" class="bd-join bd-pjoin">${ICON.cam}<span>Join the call</span></button>
          <button type="button" class="bd-join2">Join with sound only, no camera</button>
          <p class="bd-who"></p>
          <button type="button" class="bd-link bd-dev">Change camera or microphone</button>
          <div class="bd-devs" hidden><label>Camera<select class="bd-dc"></select></label><label>Microphone<select class="bd-dm"></select></label></div>
        </section>
        <section class="bd-call" hidden>
          <div class="bd-frame"><div class="bd-wait" aria-hidden="true"><i></i><span class="bd-wt">In the lobby</span></div></div>
          <div class="bd-err" hidden><p></p><div class="bd-row"><button type="button" class="bd-join bd-retry">Try again</button><button type="button" class="bd-join2 bd-tab">${ICON.ext}<span>Open the call in its own tab</span></button></div></div>
          <div class="bd-warn" hidden><p class="bd-wp">If the call is not showing here, or its buttons do not answer, you can open it in its own tab.</p><p class="bd-nc" hidden>If you see a Bestly Cloud sign-in, or the box stays empty, sign in to Bestly Cloud once in this window. It remembers you after that.</p><div class="bd-wbtns"><button type="button" class="bd-join2 bd-nclogin" hidden><span>Sign in to Bestly Cloud</span></button><button type="button" class="bd-join2 bd-again" hidden><span>Try again</span></button><button type="button" class="bd-join2 bd-tab2">${ICON.ext}<span>Open the call in its own tab</span></button></div></div>
        </section>
      </div>
      <div class="bd-ctl" hidden>
        <div class="bd-hint" role="status" hidden></div>
        <button type="button" class="bd-c bd-cm" aria-pressed="false" aria-label="Mute yourself" title="Mute yourself"><span class="bd-ci2">${ICON.mic}</span><span class="bd-cl2">Mute</span></button>
        <button type="button" class="bd-c bd-cc" aria-pressed="false" aria-label="Stop camera" title="Stop camera"><span class="bd-ci2">${ICON.cam}</span><span class="bd-cl2">Camera</span></button>
        <button type="button" class="bd-c bd-cs2" aria-pressed="false" aria-label="Share your screen" title="Share your screen"><span class="bd-ci2">${ICON.share}</span><span class="bd-cl2">Share</span></button>
        <button type="button" class="bd-c bd-cx" aria-pressed="false" aria-label="Messages" title="Messages"><span class="bd-ci2">${ICON.chat}<b class="bd-bd" hidden>0</b></span><span class="bd-cl2">Messages</span></button>
        <button type="button" class="bd-c bd-cv" aria-label="Leave the call" title="Leave the call"><span class="bd-ci2">${ICON.leave}</span><span class="bd-cl2">Leave</span></button>
      </div>
      <section class="bd-chat" hidden aria-label="Messages in the call">
        <div class="bd-sz" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Messages width. Drag it, or use the left and right arrow keys. Double-click to set it back." title="Drag to change the width. Double-click to set it back."><i></i></div>
        <div class="bd-divw"><div class="bd-div" role="separator" aria-orientation="horizontal" tabindex="0" aria-label="Video and Messages. Drag it, or use the up and down arrow keys."></div><button type="button" class="bd-grip2" aria-label="Bigger chat" title="Bigger chat"><i></i></button></div>
        <div class="bd-cin">
        <div class="bd-ch"><div class="bd-cht" role="heading" aria-level="2">Messages</div><button type="button" class="bd-cdone" aria-label="Done. Close Messages and go back to the call">Done</button></div>
        <div class="bd-clw"><div class="bd-cl" role="log" aria-live="polite" aria-label="Messages"><p class="bd-cempty" hidden>No messages yet. Write one below and the people on this call will see it.</p></div><button type="button" class="bd-cnew" hidden>New messages</button></div>
        <form class="bd-cf"><input type="text" class="bd-ci" placeholder="Write a message" aria-label="Write a message" autocomplete="off" maxlength="3000" enterkeyhint="send"><button type="submit" class="bd-cs" aria-label="Send">${ICON.send}</button></form>
      </div></section>`;
    document.body.appendChild(r);
    D.root = r;
    const q = (s) => $(s, r);
    Object.assign(D.el, { live: q(".bd-live"), head: q(".bd-head"), title: q(".bd-title"), stat: q(".bd-stat"), dot: q(".bd-dot"), tile: q(".bd-tile"),
      pre: q(".bd-pre"), call: q(".bd-call"), frameBox: q(".bd-frame"), wait: q(".bd-wait"), smallLab: q(".bd-small span"), ctl: q(".bd-ctl"), err: q(".bd-err"), warn: q(".bd-warn"), wnc: q(".bd-nc"), wp: q(".bd-wp"), wlogin: q(".bd-nclogin"), wagain: q(".bd-again"), jlab: q(".bd-pre .bd-pjoin span"), pnote: q(".bd-pnote"), pretry: q(".bd-pretry"), wt: q(".bd-wt"), j2lab: q(".bd-join2:not(.bd-tab):not(.bd-tab2):not(.bd-nclogin):not(.bd-again)"),
      video: q(".bd-prev video"), av: q(".bd-av"), ok: q(".bd-ok"), mict: q(".bd-mict"), lvl: r.querySelectorAll(".bd-lvl i"), who: q(".bd-who"),
      cm: q(".bd-cm"), cc: q(".bd-cc"), cs: q(".bd-cs2"), cx: q(".bd-cx"), cv: q(".bd-cv"), badge: q(".bd-bd"),
      notes: q(".bd-notes"), tscout: q(".bd-tscout"), chat: q(".bd-chat"), cl: q(".bd-cl"), cf: q(".bd-cf"), ci: q(".bd-ci"), cdone: q(".bd-cdone"), cnew: q(".bd-cnew"), cempty: q(".bd-cempty"), hint: q(".bd-hint"), big: q(".bd-big"), min: q(".bd-min"), fs: q(".bd-fs"), close: q(".bd-close"), fill: q(".bd-fill"), small: q(".bd-small"), pop: q(".bd-pop"), popbar: q(".bd-popbar"), pshow: q(".bd-pshow"), pback: q(".bd-pback"), pst: q(".bd-pst"), pls: r.querySelectorAll(".bd-pl"),
      sz: q(".bd-sz"), divw: q(".bd-divw"), div: q(".bd-div"), grip: q(".bd-grip2"),
      pm: q(".bd-pm"), pc: q(".bd-pc"), join: q(".bd-pre .bd-pjoin"), join2: q(".bd-join2"), dev: q(".bd-dev"), devs: q(".bd-devs"), dc: q(".bd-dc"), dm: q(".bd-dm"), tt: q(".bd-tt"), tav: q(".bd-tav") });
    wireDrag(); wireButtons(); wireSz(); wireDiv();
  };

  /* ── pre-join check ──────────────────────────────────────────────── */
  const stopPre = () => {
    cancelAnimationFrame(D.pre.raf); D.pre.raf = 0;
    if(D.pre.stream){ D.pre.stream.getTracks().forEach(t => { try { t.stop(); } catch {} }); D.pre.stream = null; }
    try { if(D.pre.ctx){ D.pre.ctx.close(); } } catch {}
    D.pre.ctx = null; if(D.el.video) D.el.video.srcObject = null;
  };
  const startPre = async () => {
    stopPre();
    if(D.st.joined) return;      /* the call is live (or starting): the page never asks for the camera or microphone again */
    if(v5on()) return;           /* round 5: the call page opens the self view; this page never captures (iOS bug 179363: a second capture mutes the first) */
    const e = D.el; e.mict.textContent = "Checking your microphone"; e.ok.hidden = true;
    if(isIOS()){
      D.root.classList.add("bd-ios", "bd-nocam"); e.mict.textContent = "Your camera and microphone turn on when you join.";
      const lab = D.root.querySelector(".bd-prev .bd-lab"); if(lab) lab.textContent = "Your camera turns on when you join";
      return;
    }
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ e.mict.textContent = "This browser cannot check your camera. You can still join."; return; }
    try{
      const cons = { audio: e.dm.value ? { deviceId: { exact: e.dm.value } } : true, video: e.dc.value ? { deviceId: { exact: e.dc.value } } : true };
      const s = await navigator.mediaDevices.getUserMedia(cons);
      if(!D.st.open || D.st.joined){ s.getTracks().forEach(t => t.stop()); return; }
      D.pre.stream = s; e.video.srcObject = s; e.video.play().catch(() => {});
      s.getAudioTracks().forEach(t => t.enabled = D.pre.mic); s.getVideoTracks().forEach(t => t.enabled = D.pre.cam);
      e.mict.textContent = "Your microphone is working"; e.ok.hidden = false; D.root.classList.toggle("bd-nocam", !D.pre.cam);
      try{
        const AC = window.AudioContext || window.webkitAudioContext, ctx = new AC(), src = ctx.createMediaStreamSource(s), an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an); D.pre.ctx = ctx;
        const buf = new Uint8Array(an.frequencyBinCount);
        const tick = () => { an.getByteTimeDomainData(buf); let m = 0; for(let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i] - 128)); const lvl = Math.min(5, Math.round(m / 128 * 14)); e.lvl.forEach((b, i) => b.classList.toggle("on", D.pre.mic && i < lvl)); D.pre.raf = requestAnimationFrame(tick); };
        tick();
      }catch{}
      try{
        const devs = await navigator.mediaDevices.enumerateDevices();
        const fill = (sel, kind) => { const cur = sel.value; sel.innerHTML = devs.filter(d => d.kind === kind).map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || (kind === "videoinput" ? "Camera " : "Microphone ") + (i + 1))}</option>`).join(""); if(cur) sel.value = cur; };
        fill(e.dc, "videoinput"); fill(e.dm, "audioinput");
      }catch{}
    }catch(err){
      const n = String(err && err.name || "");
      e.mict.textContent = /NotAllowed|Security/.test(n) ? "Your browser is blocking the camera and microphone. You can still join with sound only." : "We could not reach your camera or microphone. You can still join.";
      D.root.classList.add("bd-nocam");
    }
  };
  const paintPre = () => {
    const e = D.el, call = (D.cfg && D.cfg.getCall && D.cfg.getCall()) || {};
    const mins = call.minutes != null ? call.minutes : null;
    e.stat.textContent = mins != null ? (mins < 1 ? "Ready when you are, it just started" : `Ready when you are, started ${minLong(mins)} ago`) : "Ready when you are";
    const names = D.cfg && D.cfg.names ? D.cfg.names() : "";
    /* your own face (or your letter) in the camera box while your camera is off */
    if(D.cfg && D.cfg.me){ const me = D.cfg.me() || {}; putFace(e.av, me.key || null, me.name || "?"); }
    const wo = D.win && D.winOp && D.winOp.live ? D.winOp : null;      /* the other page is in the call: this window says so, it never says nobody has started it */
    const starting = !!(D.cfg && D.cfg.canStart && !call.live && !wo);
    if(starting){
      e.stat.textContent = "Nobody has started it yet";
      e.who.textContent = "You will be the first one in, so joining starts the call. We do not message " + /*PORTAL*/ ((D.cfg && typeof D.cfg.waitFor === "function" && D.cfg.waitFor()) || "them") + ".";
    } else {
      e.who.textContent = names ? `${names} ${/ and /.test(names) ? "are" : "is"} in the call` : "Nobody else is in the call yet";
    }
    if(wo && wo.text) e.stat.textContent = wo.text;
    e.title.textContent = (D.cfg && D.cfg.title) || "Strategy call";      /* always the name; "Nobody has started it yet" and the Start button say the rest */
    const five = v5on(), bad = five && D.v5.perm === "denied";
    if(e.jlab) e.jlab.textContent = starting ? "Start the call" : (five ? "Join now" : "Join the call");
    if(e.j2lab) e.j2lab.textContent = bad ? "Join anyway, without my camera" : (starting ? "Start with sound only, no camera" : "Join with sound only, no camera");
    e.pm.setAttribute("aria-pressed", String(D.pre.mic)); e.pm.innerHTML = `${D.pre.mic ? ICON.mic : ICON.micoff}<span>${D.pre.mic ? "Microphone on" : "Microphone off"}</span>`;
    e.pc.setAttribute("aria-pressed", String(D.pre.cam)); e.pc.innerHTML = `${D.pre.cam ? ICON.cam : ICON.camoff}<span>${D.pre.cam ? "Camera on" : "Camera off"}</span>`;
    paintV5();
  };
  /* round 5: the stage cover and the one plain line under the self view, from what the frame said. The cover stays until her own picture is up (or the frame says why it cannot be). */
  const waitText = (t) => { const w = D.el.wt; if(w && w.textContent !== t) w.textContent = t; };
  const paintV5 = () => {
    const r = D.root, e = D.el, v = D.v5; if(!r || !e.wt) return;
    const on = v5on() && !D.st.joined && D.st.open;
    r.dataset.v5 = on ? "1" : "0"; r.dataset.perm = on ? (v.perm || "") : "";
    if(!on){ e.pnote.hidden = true; e.pretry.hidden = true; e.join.hidden = false; return; }
    let head = "Getting your camera ready", note = "", kind = "wait";
    const who = isIOS() ? "your phone" : "your browser";
    if(v.perm === "denied"){ head = "The camera is blocked"; note = denyWords(); kind = "bad"; }
    else if(v.perm === "none"){ head = "No camera found"; note = "We could not find a camera or a microphone. You can still join and listen."; kind = "bad"; }
    else if(v.preview){ head = ""; note = "Your camera and microphone work. Tap Join now when you are ready."; kind = "ok"; }
    else if(v.asked && v.perm === "prompt"){ head = "Allow your camera"; note = `Tap Allow when ${who} asks to use your camera and microphone.`; }
    waitText(head); e.wait.classList.toggle("off", !head);
    e.pnote.hidden = !note; if(e.pnote.textContent !== note) e.pnote.textContent = note; e.pnote.dataset.kind = kind;
    const bad = v.perm === "denied";
    e.pretry.hidden = !bad; e.join.hidden = bad;
  };

  /* ── join, the frame and the bridge ──────────────────────────────── */
  const setMode = (m) => { D.st.mode = m; D.root.dataset.mode = m; applyChrome(); };
  const showErr = (msg) => { const e = D.el; e.err.hidden = false; $("p", e.err).textContent = msg; e.pre.hidden = true; e.call.hidden = false; e.frameBox.hidden = true; e.ctl.hidden = true; };
  const origin = (u) => { try { return new URL(u, location.href).origin; } catch { return ""; } };
  const post = (cmd, extra) => { try { if(D.frame && D.frame.contentWindow){ const m = { type: "bestly-call", cmd }; if(extra) Object.assign(m, extra); D.frame.contentWindow.postMessage(m, D.origin || "*"); } } catch(e) { fault("post", String(e && e.message || e)); } };
  /* round 5: a join carries the devices she chose, so the frame (which already has them open from the self view) opens nothing new */
  const joinOpts = () => D.v5.mode === "v5" ? { mic: !D.st.muted, camera: !!D.st.camera } : null;
  /* the frame is silent: say so calmly. A seat that uses its own Bestly Cloud session (Jared) may just need to sign in once. */
  const cloudLogin = () => { try { const c = D.cfg && D.cfg.cloudLogin; return typeof c === "function" ? c() : (c || ""); } catch { return ""; } };
  const LOGIN_OWN = "You're not signed in to Bestly Cloud in this browser. Sign in once, then tap Try again.";
  const LOGIN_GUEST = "The call could not sign you in. Please tap Try again. If it still does not work, open the call in its own tab.";
  const NC_HELP = "If you see a Bestly Cloud sign-in, or the box stays empty, sign in to Bestly Cloud once in this window. It remembers you after that.";
  const LOGIN_SIGNING = "Sign in to Bestly Cloud in the window above. You come back to the call by yourself. If you do not, tap I have signed in.";
  const showWarn = () => {
    const e = D.el, own = !!cloudLogin(), lg = D.login, sg = !!(D.signing && own), was = !e.warn.hidden;
    e.warn.hidden = false; e.warn.classList.toggle("bd-wguest", !own); e.warn.classList.toggle("bd-wsign", sg);
    e.wnc.textContent = sg ? LOGIN_SIGNING : (lg ? (own ? LOGIN_OWN : LOGIN_GUEST) : NC_HELP);
    e.wnc.hidden = !(own || lg); e.wlogin.hidden = !own || sg; e.wagain.hidden = !(own || lg); e.wp.hidden = own || lg;
    { const ag = e.wagain.querySelector("span"); if(ag) ag.textContent = sg ? "I have signed in" : "Try again"; }
    paintLogin();
    if(lg && !was) say(e.wnc.textContent);
  };
  const paintLogin = () => { const r = D.root; if(!r) return; r.dataset.login = D.login && D.st.joined && !!cloudLogin() ? "1" : "0"; r.dataset.signing = D.signing ? "1" : "0"; };
  /* the call is still starting: the dock has asked to join and the frame has not yet said joined:true */
  const connecting = () => !!(D.st.joined && !D.frameJoined && D.st.bridge !== "off");
  /* the host page says "Joining your call" too (the board's call pill, Studio's call button) until the call has started */
  let lastConn = null;
  const notifyConn = () => { const c = connecting(); if(c === lastConn) return; lastConn = c; try{ D.cfg && D.cfg.onConnect && D.cfg.onConnect(c); }catch{} };
  /* the dock gave up (bridge off while joined): she is NOT in the call, and the host's pill or button must not say she is */
  let lastFail = null;
  const notifyFail = () => { const f = !!(D.st.joined && D.st.bridge === "off"); if(f === lastFail) return; lastFail = f; try{ D.cfg && D.cfg.onFail && D.cfg.onFail(f); }catch{} };
  /* the dark "Joining your call" placeholder over the frame: it goes at the frame's first word, or when Talk's own buttons are shown */
  const waitOn = (on) => { const w = D.el.wait; if(w) w.classList.toggle("off", !on); };
  /* a window parked at a spot is put back at it whenever its size has changed (a status line that wrapped, a share starting or ending) */
  const settle = () => {
    const r = D.root; if(!r || r.hidden || !D.st.open || r.classList.contains("dragging")) return;
    if(r.dataset.mode === "stage" || r.dataset.full === "1") return;
    place(false);
  };
  /* "Sign in to Bestly Cloud": the CALL FRAME goes to Bestly Cloud's sign-in page (redirect_url = the call page, so Bestly Cloud sends it back into the call afterwards).
     Nothing opens in a new tab: a Safari web app sends other sites to Safari, and she would never come back. */
  const loginURL = () => {
    try {
      const base = cloudLogin(); if(!base) return "";
      const u = new URL(base, location.href);
      if(D.callUrl){ const c = new URL(D.callUrl, location.href); if(c.origin === u.origin && c.pathname !== "/login") u.searchParams.set("redirect_url", c.pathname + c.search); }
      return u.href;
    } catch { return ""; }
  };
  const signIn = () => {
    const f = D.frame, u = loginURL();
    if(!f || !u || !D.st.joined){ try { const b = cloudLogin(); if(b) window.open(b, "_blank", "noopener"); } catch {} return; }      /* no frame to sign in inside: the old way */
    D.signing = true; D.signLoads = 0; D.signT = Date.now(); D.login = true;
    clearInterval(D.timers.rejoin); clearTimeout(D.timers.bridge); waitOn(false);
    if(phone() && D.root.dataset.mode === "tile") expand();
    try { f.src = u; } catch(err) { fault("login_nav", String(err && err.message || err)); }
    showWarn(); applyChrome(); paintHead(); say(LOGIN_SIGNING);
  };
  const giveUp = (code) => {
    D.st.bridge = "off"; D.root.dataset.bridge = "off"; waitOn(false); showWarn(); fault(code, D.origin);
    applyChrome(); paintCtl(); paintHead();
  };
  /* a freshly signed-in seat can ignore the first join until the bridge is ready: send it again every second, up to T.give */
  const askJoin = () => {
    if(!D.frame || !D.st.joined || D.frameJoined){ clearInterval(D.timers.rejoin); return; }
    if(Date.now() - D.pingT0 > T.give){ clearInterval(D.timers.rejoin); giveUp("join_ignored"); return; }
    post("join", joinOpts());
  };
  const startPings = () => {
    D.pingT0 = Date.now(); clearInterval(D.timers.rejoin);
    askJoin();
    if(D.frame && D.st.joined && !D.frameJoined) D.timers.rejoin = setInterval(askJoin, T.ping);
  };
  const armBridge = (ms) => {
    clearTimeout(D.timers.bridge);
    D.timers.bridge = setTimeout(() => { if(D.st.bridge === "wait" && D.st.joined) giveUp("bridge_silent"); }, ms);
  };
  /* the call frame is made in one place, so a pre-warmed frame and a tap-time frame are the same thing */
  const makeFrame = (url) => {
    const f = document.createElement("iframe");
    url = withBv(url); D.callUrl = url;
    f.title = "Strategy call"; f.setAttribute("allow", ALLOW); f.allow = ALLOW; f.setAttribute("allowfullscreen", ""); f.allowFullscreen = true; f.referrerPolicy = "no-referrer";
    /* every (re)load of the frame starts the join over; a frame that is only warming up has nothing to join yet */
    f.addEventListener("load", () => {
      if(D.frame !== f) return;
      if(D.warm.f === f) D.warm.loaded = true;
      D.layoutSent = null;      /* a page that loaded again has forgotten its layout */
      if(!D.st.joined){ if(D.st.open) askPreview(true); return; }
      D.frameJoined = false;
      if(D.signing || D.login){                        /* the sign-in page, a signed-out page that loaded again, or the page Bestly Cloud sends her on to: no pings, no giving up. */
        if(D.signing) D.signLoads++;                   /* The page's first word starts the join (see onMsg); one quiet join, for a bridge that has no hello, tells a call page from a form */
        clearTimeout(D.timers.probe); D.timers.probe = setTimeout(() => { if(D.frame === f && D.st.joined && (D.login || D.signing)) post("join"); }, 700);
        return;
      }
      startPings();
    });
    f.src = url;
    return f;
  };
  const FIT_W = 900, FIT_H = 600;
  /* round 5: a call page that speaks bridge 5 is told when its window is the tile or the bar ("stage": the person talking fills it) and when it is a normal window again */
  const sendLayout = () => {
    if(!D.frame || D.v5.mode !== "v5" || !D.root || D.root.hidden) return;
    const want = D.root.dataset.mini === "1" ? "stage" : "normal";
    if(D.layoutSent === want) return;
    D.layoutSent = want; post("layout", { mode: want });
  };
  const fitFrame = () => {
    const f = D.frame, box = D.el && D.el.frameBox; if(!f || !box || !D.root) return;
    sendLayout();
    const cw = box.clientWidth, ch = box.clientHeight;
    if(D.root.dataset.mini === "1" && cw && ch && !D.login && !D.signing && D.st.bridge !== "off"){
      /* the tile and the bar show the call itself, live: the page is laid out at a small phone's (or a thumbnail's) size and scaled to cover the box, centred */
      const bar = D.root.dataset.mode === "bar" || D.root.dataset.hand === "1", lw = bar ? FIT_W : 360, lh = bar ? FIT_H : 640, k = Math.max(cw / lw, ch / lh);
      const tf = `translate(${Math.round((cw - lw * k) / 2)}px,${Math.round((ch - lh * k) / 2)}px) scale(${k.toFixed(4)})`;
      f.style.width = lw + "px"; f.style.height = lh + "px"; f.style.transformOrigin = "0 0"; if(f.style.transform !== tf) f.style.transform = tf;
      box.dataset.fit = "mini"; return;
    }
    const keep = (phone() && D.root.dataset.full === "1") || D.login || D.signing || D.st.bridge === "off" || !cw || !ch;
    const k = keep ? 1 : Math.min(1, cw / FIT_W, ch / FIT_H);
    if(k >= 0.999){ if(f.style.transform || f.style.width){ f.style.width = ""; f.style.height = ""; f.style.transform = ""; f.style.transformOrigin = ""; } box.dataset.fit = "1"; return; }
    const w = Math.ceil(cw / k) + "px", h = Math.ceil(ch / k) + "px", tf = "scale(" + k.toFixed(4) + ")";
    if(f.style.width !== w) f.style.width = w;
    if(f.style.height !== h) f.style.height = h;
    f.style.transformOrigin = "0 0"; if(f.style.transform !== tf) f.style.transform = tf;
    box.dataset.fit = k.toFixed(3);
  };
  const putFrame = (f) => {
    const box = D.el.frameBox;
    box.querySelectorAll("iframe").forEach(x => x.remove());
    box.insertBefore(f, D.el.wait);
    D.frame = f;
    fitFrame();
  };

  /* ── pre-warm: the call frame loads while she checks her camera ───── */
  const prewarmOn = () => { if(isIOS() && D.legacy) return false; try {      /* iOS with an older call page: no early frame, so nothing can capture before Join (the v5 page captures only on "preview") */ const p = D.cfg && D.cfg.prewarm; return (typeof p === "function" ? p() : p) !== false; } catch { return true; } };
  const unwarm = () => {
    const w = D.warm; w.id++; clearTimeout(D.timers.warmttl);
    const f = w.f; Object.assign(w, { state: "idle", f: null, loaded: false, alive: false, p: null, t0: 0 });
    D.root.dataset.warm = "0"; D.el.call.inert = false; D.el.call.removeAttribute("aria-hidden");
    clearInterval(D.timers.askp); D.timers.askp = 0;
    if(f){ if(D.frame === f) D.frame = null; try { f.src = "about:blank"; } catch {} f.remove(); }
    if(!D.st.joined){ D.v5 = freshV5(D.legacy ? "legacy" : "pending"); D.el.call.hidden = !(D.st.open && v5on()); D.frameJoined = false; D.st.bridge = "wait"; D.root.dataset.bridge = "wait"; waitText("Getting your camera ready"); waitOn(true); paintV5(); }
  };
  const warmFail = (why, detail) => { unwarm(); D.warm.state = "failed"; fault("prewarm_" + why, detail || D.origin); if(D.st.open && !D.st.joined){ D.el.call.hidden = true; applyChrome(); paintPre(); startPre(); } };      /* no early frame: the card is the plain one, and the tap does it the way it always did */
  const warm = () => {
    const w = D.warm;
    if(!prewarmOn() || D.st.joined || w.state === "ticket" || w.state === "loading") return;
    const id = ++w.id; Object.assign(w, { state: "ticket", f: null, loaded: false, alive: false, t0: Date.now() });
    w.p = (async () => {
      let t;
      try{ t = await getTicket(); if(!t || !t.url) throw new Error((t && t.error) || "no_url"); }
      catch(err){ if(w.id === id){ w.state = "failed"; w.p = null; fault("prewarm_ticket", String(err && err.message || err)); if(D.st.open && !D.st.joined){ D.el.call.hidden = true; applyChrome(); paintPre(); startPre(); } } return; }
      if(w.id !== id || (!D.st.open && !D.st.joined)) return;          // closed, or started over, while the ticket was on its way
      D.origin = origin(t.url);
      const f = makeFrame(t.url);
      w.f = f; w.state = "loading"; w.p = null;
      D.frameJoined = false; D.st.bridge = "wait"; D.root.dataset.bridge = "wait"; waitOn(true);
      putFrame(f);
      if(!D.st.joined){
        D.el.call.hidden = false;
        if(v5on()){ D.root.dataset.warm = "0"; D.el.call.inert = false; D.el.call.removeAttribute("aria-hidden"); }      /* round 5: the frame is the self view, in plain sight */
        else { D.root.dataset.warm = "1"; D.el.call.inert = true; D.el.call.setAttribute("aria-hidden", "true"); }
        paintV5();
      }
      clearTimeout(D.timers.warmttl);
      D.timers.warmttl = setTimeout(() => { if(!D.st.joined && w.id === id) unwarm(); }, T.warmTtl);
    })();
    return w.p;
  };

  /* ── round 5: the self view lives in the call page ─────────────────────────────────────────────────────────────── */
  const frameLive = () => !!(D.frame && D.frame.contentWindow && (D.warm.alive || D.warm.loaded || D.st.bridge === "ok"));
  /* ask the call page to open its own self view: its permission question shows at once. Asked again every 1.5 s until it says it is up (twice is safe). */
  const askPreview = (now) => {
    if(!v5on() || D.st.joined || !D.st.open || D.winHold) return;
    if(D.timers.askp){ if(now && D.askTick) D.askTick(); return; }      /* already asking: only the call page's first sign of life asks once more at once */
    const t0 = Date.now();
    const tick = D.askTick = () => {
      const v = D.v5;
      const coming = D.warm.state === "ticket" || D.warm.state === "loading";      // the call page is still on its way
      if(!v5on() || D.st.joined || !D.st.open || (!D.frame && !coming) || v.preview || v.perm === "denied" || v.perm === "none" || Date.now() - t0 > 60000){ clearInterval(D.timers.askp); D.timers.askp = 0; return; }
      if(frameLive() && !D.winHold){ post("preview", { mic: !!D.pre.mic, camera: !!D.pre.cam }); if(!v.asked){ v.asked = true; paintV5(); } }
    };
    D.timers.askp = setInterval(tick, 1500); tick();
  };
  /* a call page with no bv in what it says is an older theme: it keeps today's way (this page opens the check on a desktop, and nothing on an iPhone) */
  const goLegacy = () => {
    if(D.legacy) return;
    D.legacy = true; D.v5 = freshV5("legacy"); clearInterval(D.timers.askp); D.timers.askp = 0;
    if(D.st.open && !D.st.joined){
      if(isIOS()) unwarm();
      else if(D.warm.state === "loading"){ D.root.dataset.warm = "1"; D.el.call.hidden = false; D.el.call.inert = true; D.el.call.setAttribute("aria-hidden", "true"); }
      else D.el.call.hidden = true;
      waitText("In the lobby"); applyChrome(); paintPre(); startPre();
    }
  };
  const noteV5 = (d) => {
    const v = D.v5;
    if(typeof d.bv === "number" && d.bv >= 5){
      const first = v.mode !== "v5"; v.mode = "v5"; v.bv = d.bv; if(first) setTimeout(sendLayout, 0);
      if(typeof d.phase === "string") v.phase = d.phase;
      if(typeof d.perm === "string") v.perm = d.perm;
      if(typeof d.preview === "boolean") v.preview = d.preview;
      if(typeof d.ready === "boolean") v.ready = d.ready;
      if(typeof d.others === "number") v.others = Math.max(0, d.others);
      v.lobbyText = typeof d.lobbyText === "string" ? d.lobbyText : "";
      v.slow = d.slow === true; v.joining = d.joining === true;
      return;
    }
    /* no bv: an older call page, but only once it has answered something that is the call page (not its hello, not a sign-in card) */
    if(v.asked && !d.hello && !d.loggedOut && d.error !== "login" && !D.legacy) goLegacy();
  };
  const onAck = (d) => {
    const v = D.v5;
    if(d.cmd === "preview"){
      if(d.ok === false && d.error === "unknown-cmd"){ goLegacy(); return; }
      if(d.ok === false && d.error === "denied"){ v.perm = "denied"; v.preview = false; }
      else if(d.ok === false && d.error === "nodevice"){ v.perm = "none"; v.preview = false; }
      paintV5(); paintPre();
    }
    else if(d.cmd === "join" && d.ok === false && d.error === "join-timeout") fault("join_timeout", D.origin);      /* the pings go on until T.give */
    else if(d.cmd === "leave" && D.leaveW){ try { D.leaveW(); } catch {} }
  };

  const join = async (soundOnly) => {
    if(!D.win && D.pop.on && D.pop.joined){ fault("join_blocked", "the call is in its own window"); return; }      /* one seat at a time */
    const e = D.el, w = D.warm;
    D.login = false; D.signing = false; paintLogin(); D.st.camera = !(soundOnly || !D.pre.cam); D.st.muted = !D.pre.mic; D.want = { mute: !D.pre.mic, cam: D.st.camera };
    stopPre();
    e.pre.hidden = true; e.call.hidden = false; e.err.hidden = true; e.frameBox.hidden = false; e.warn.hidden = true;
    D.st.joined = true; D.st.joinedAt = Date.now(); D.st.bridge = "wait"; D.root.dataset.bridge = "wait"; D.frameJoined = false;
    D.lobbyT0 = Date.now(); clearTimeout(D.timers.slow); D.timers.slow = setTimeout(() => { if(D.st.joined && connecting()) paintHead(); }, 45500);
    clearInterval(D.timers.askp); D.timers.askp = 0; waitText("In the lobby");
    e.pretry.hidden = true; e.join.hidden = false; D.root.dataset.v5 = "0";
    setMode("call"); e.ctl.hidden = false; paintCtl(); paintHead(); say("You are in the lobby.");
    /* the ticket may still be on its way from the moment the pre-join check opened */
    if(w.state === "ticket" && w.p){ try { await w.p; } catch {} }
    if(!D.st.joined) return;                                           // she left while it was coming
    clearTimeout(D.timers.warmttl);
    const warmF = (w.state === "loading" && w.f && w.f.isConnected && D.frame === w.f) ? w.f : null;
    if(warmF){
      /* this frame has been loading since the pre-join check opened: it is hers now, and the join goes out at once */
      const age = Date.now() - w.t0, alive = w.alive;
      w.id++; Object.assign(w, { state: "idle", f: null, loaded: false, alive: false, p: null, t0: 0 });
      e.call.inert = false; e.call.removeAttribute("aria-hidden"); D.root.dataset.warm = "0";
      D.st.bridge = alive ? "ok" : "wait"; D.root.dataset.bridge = D.st.bridge;
      if(!alive) armBridge(Math.max(T.warmMin, T.bridge - age));
      startPings();
    } else {
      /* the way it always was: ticket, then the frame, then the join once the frame has loaded */
      if(w.state !== "idle") unwarm();
      let t;
      try{ t = await getTicket(); if(!t || !t.url) throw new Error((t && t.error) || "no_url"); }
      catch(err){ D.st.joined = false; setMode("prejoin"); showErr("We could not open the call. Please try again in a moment."); fault("ticket", String(err && err.message || err)); return; }
      if(!D.st.joined) return;
      D.origin = origin(t.url);
      D.frameJoined = false; waitOn(true);
      putFrame(makeFrame(t.url));
      armBridge(T.bridge);
    }
    clearInterval(D.timers.clock); D.timers.clock = setInterval(paintHead, 20000);
    chatStart(); paintCtl(); paintHead(); place(true);
    try{ D.cfg.onChange && D.cfg.onChange(true); }catch{}
  };
  const waitLeft = (res) => { let f = false; const fin = () => { if(f) return; f = true; clearTimeout(tm); if(D.leaveW === fin) D.leaveW = null; res(); }; const tm = setTimeout(fin, 3000); D.leaveW = fin; };      /* the call page says it has left (3 s at most) */
  const leave = (keep, sent, wait) => {
    const lm = D.win && !D.winLeft ? { mic: !D.st.muted, cam: !!D.st.camera } : null; if(lm) D.winLeft = true;
    const lw = wait ? new Promise((res) => waitLeft(res)) : null;      /* wait: the window tells the other page it has left only after the call page has */
    if(!sent) post("leave");
    if(lm){ if(lw) lw.then(() => winSend({ t: "win", s: "left", mic: lm.mic, cam: lm.cam })); else winSend({ t: "win", s: "left", mic: lm.mic, cam: lm.cam }); }
    const done = () => {
      D.dfull = false; fsExit();
      clearTimeout(D.timers.bridge); clearInterval(D.timers.clock); clearInterval(D.timers.rejoin); clearTimeout(D.timers.slow); clearInterval(D.timers.askp); D.timers.askp = 0;
      if(D.frame){ try { D.frame.src = "about:blank"; } catch {} D.frame.remove(); D.frame = null; }
      D.el.frameBox.querySelectorAll("iframe").forEach(x => x.remove()); waitText("Getting your camera ready"); waitOn(true); D.v5 = freshV5(D.legacy ? "legacy" : "pending");
      D.login = false; D.signing = false; paintLogin(); D.el.warn.hidden = true; D.frameJoined = false; lastConn = null; Object.assign(D.st, { scout: false, joined: false, sharing: null, people: [], stageOff: false, chatOpen: false, bridge: "wait", unread: 0 });
      notifyFail();
      D.chat.run = false; D.el.chat.hidden = true; D.root.dataset.chat = "0"; D.root.dataset.cpos = "0"; D.root.dataset.kb = "0";
      cancelSz();
      D.root.style.removeProperty("height");
      if(keep){ D.root.hidden = false; D.st.open = true; applyChrome(); place(false); geomPing(); say("Moving the call to its own window."); return; }      /* Pop out: this page has left, the other window takes the call */
      D.root.hidden = true; D.st.open = false; document.documentElement.classList.remove("bd-stage"); geomPing();
      try{ D.cfg.onChange && D.cfg.onChange(false); }catch{}
      say("You left the call.");
      if(D.win){ D.winSaid = false; winGone(); }
    };
    if(lw) lw.then(() => setTimeout(done, 0)); else setTimeout(done, D.frame ? 350 : 0);
  };
  const onMsg = (ev) => {
    const d = ev.data; if(!d || (d.type !== "bestly-call-state" && d.type !== "bestly-call-ack")) return;
    if(!D.frame || ev.source !== D.frame.contentWindow) return;
    if(D.origin && ev.origin !== D.origin) return;
    if(d.type === "bestly-call-ack"){ onAck(d); return; }
    const s = D.st, w = D.warm, loading = d.loading === true;
    if(D.leaveW && d.joined === false && !loading){ try { D.leaveW(); } catch {} }      /* the call page says it has left */
    /* N9: signed out of Bestly Cloud. The frame is a guest page that can never join, so stop asking it to and say so now (not after the 54 s of pings run out).
       Joined: the panel under the call says it. Not joined (the pre-warmed frame): it is dropped quietly, and Join makes a fresh one and says so then. */
    if(d.loggedOut === true || d.error === "login"){
      /* while the frame shows the sign-in page, the sign-out cards that were on it a moment ago may still be talking: only a card that comes after the sign-in page counts */
      if(D.signing && (D.signLoads < 2 || Date.now() - D.signT < 4000)) return;
      if(D.signing){ D.signing = false; if(s.joined) showWarn(); }
      clearInterval(D.timers.rejoin); clearTimeout(D.timers.bridge); waitOn(false);
      if(s.bridge !== "off"){
        if(s.joined){ D.login = true; giveUp("login"); }
        else { s.bridge = "off"; D.root.dataset.bridge = "off"; if(w.f && w.f === D.frame) warmFail("frame", "login"); }
      } else if(s.joined && !D.login){ D.login = true; if(!D.el.warn.hidden) showWarn(); paintHead(); }     // the panel was up for another reason: it says what this is now
      return;
    }
    if(D.login){ D.login = false; D.signing = false; paintLogin(); if(s.joined && !D.frameJoined) startPings(); }          // she signed in (inside the frame): the page came back, so ask it to join again
    else if(D.signing){ D.signing = false; paintLogin(); }
    s.bridge = "ok"; D.root.dataset.bridge = "ok"; D.el.warn.hidden = true; clearTimeout(D.timers.bridge);
    noteV5(d);
    if(!(v5on() && !s.joined)) waitOn(false);      /* round 5: the cover over the card's picture stays until the self view is up (paintV5 decides) */
    if(w.f && w.f === D.frame) w.alive = true;
    if(!s.joined){
      /* a pre-warmed frame that is not joined yet: only that it is alive matters; one that reports an error is dropped, and the Join tap does it the old way */
      if(w.f && w.f === D.frame && d.error) warmFail("frame", String(d.error));
      else if(D.st.open){ askPreview(!D.v5.asked); paintPre(); }
      return;
    }
    const wasJoined = s.joined, wasUp = D.frameJoined;
    /* muted and camera mean something only once the call is joined; the hello and the loading messages carry neither */
    if(d.joined === true){ s.muted = !!d.muted; s.camera = d.camera !== false; }
    const raw = Array.isArray(d.people) ? d.people : []; /* the bridge says whether the notetaker is on the call (people and count already leave it out); the name filter only guards an older bridge */
    s.scoutSaid = typeof d.notetaker === "boolean" || s.scoutSaid === true; s.scout = typeof d.notetaker === "boolean" ? d.notetaker : raw.some(isScout); s.people = raw.filter(p => !isScout(p));
    if(d.joined === true || (typeof d.bv === "number" && d.bv >= 5 && d.joined !== false && phaseIn(d.phase) && !loading)) D.frameJoined = true; else if(loading) D.frameJoined = false;     // a page that is loading again is not in the call
    winAnnounce(); try { if(D.win) traceTick(); } catch {}      /* the trace also runs on the call page's own messages: a window behind others has its timers slowed */
    const was = s.sharing; s.sharing = d.sharing && typeof d.sharing === "object" ? d.sharing : null;
    if(!s.sharing) s.stageOff = false;
    if(d.error){ s.error = String(d.error); fault("frame", s.error); }
    if(D.want && d.joined === true){
      /* what she chose in the pre-join check; the bridge sends the new state a moment later, so the buttons already show it */
      const wn = D.want;
      if(wn.mute && !s.muted){ post("mute"); s.muted = true; }
      else if(wn.mset && !wn.mute && s.muted){ post("unmute"); s.muted = false; }            // she turned the microphone back on while the call was starting
      if(!wn.cam && s.camera){ post("camera-off"); s.camera = false; }
      else if(wn.cset && wn.cam && !s.camera){ post("camera-on"); s.camera = true; }         // and the camera
      D.want = null;
    }
    if(d.joined === false && !loading && wasJoined && D.frameJoined && !D.leaving){ /* the call ended from inside */ leave(); return; }
    applyChrome(); paintCtl(); paintHead(); settle();
    if(!wasUp && D.frameJoined) say("You are in the call.");
    if(!was && s.sharing && !s.sharing.me) say(`${s.sharing.by || "Someone"} is showing a screen. The call window now fills the screen.`);
  };
  const stageNow = () => !!(D.st.joined && D.st.sharing && !D.st.sharing.me && !D.st.stageOff && D.st.bridge === "ok");

  /* ── chrome: which parts show, per mode ──────────────────────────── */
  const applyChrome = () => {
    const r = D.root, s = D.st, ph = phone();
    r.dataset.phone = ph ? "1" : "0"; r.dataset.size = D.pos.size;
    let mode = s.mode;
    if(s.joined){ mode = stageNow() || D.win || (D.dfull && !ph && !D.bar) ? "stage" : (D.bar ? "bar" : (ph && !D.full ? "tile" : "call")); }
    else mode = D.pop.on ? "pop" : "prejoin";      /* "pop": the call is in its own window and this page shows the small card */
    const hand = !!(s.joined && D.pop.on && !D.pop.joined && !D.win);      /* the window is on its way: the call is still here, small, under the card */
    if(hand) mode = "pop";
    if(mode !== "stage" && s.mode === "stage"){ /* the share ended: back to the spot it was in */ }
    s.mode = mode; r.dataset.mode = mode; r.dataset.full = (ph && s.joined && D.full && mode !== "tile" && mode !== "bar" && mode !== "pop") || mode === "prejoin" && ph ? "1" : "0";
    r.dataset.hand = hand ? "1" : "0"; r.dataset.mini = s.joined && (mode === "tile" || mode === "bar" || hand) ? "1" : "0";      /* round 5: the tile and the bar show the live call, never an empty picture */
    r.dataset.v5 = mode === "prejoin" && v5on() ? "1" : "0";
    document.documentElement.classList.toggle("bd-stage", mode === "stage" || r.dataset.full === "1");
    const e = D.el;
    e.tile.hidden = mode !== "tile";
    e.head.hidden = mode === "tile";
    e.small.hidden = mode !== "stage";
    e.fs.hidden = !(s.joined && !D.dfull && (mode === "call" || mode === "stage") && fsCan());
    e.fill.hidden = !(ph && s.joined && mode === "call");
    e.big.hidden = ph || mode === "stage" || mode === "prejoin" || mode === "bar";
    e.min.hidden = mode === "stage" || mode === "prejoin" || mode === "bar";
    e.close.hidden = s.joined;
    r.dataset.win = D.win ? "1" : "0";
    e.pop.hidden = !(s.joined && !D.pop.on && (mode === "call" || mode === "stage") && popOk());
    e.popbar.hidden = mode !== "pop"; if(mode === "pop") popPaint();
    if(D.win){ e.small.hidden = true; e.fs.hidden = true; }      /* the call window fills its own window: no sizes, no full screen */
    { const isFull = r.dataset.full === "1";       /* on a phone the call window is either the small tile or the full screen: this one button goes to the other */
      e.fill.setAttribute("aria-label", isFull ? "Make small. The call goes back to its small window." : "Fill the screen"); e.fill.title = isFull ? "Make small" : "Fill the screen";
      e.fill.innerHTML = isFull ? ICON.shrink + "<span>" + esc(innerWidth < 400 ? "Back" : ((D.cfg && D.cfg.backWord) || "Back to the board")) + "</span>" : ICON.big; e.fill.classList.toggle("bd-fillw", isFull); }
    if(e.smallLab) e.smallLab.textContent = ph ? "Make small" : (D.dfull ? "Exit full screen" : "Make the window small");
    e.small.setAttribute("aria-label", ph ? "Make small. The call goes back to its small window." : (D.dfull ? "Exit full screen" : "Make the window small"));
    e.ctl.hidden = !s.joined || mode === "bar" || mode === "tile" || mode === "pop" || D.st.bridge === "off" && false;
    /* Messages: beside the video when there is room, under a strip of video when there is not (never over the people) */
    const chatOn = !!(s.chatOpen && s.joined && (mode === "call" || mode === "stage"));
    const plan = chatOn ? chatPlan(mode, r.dataset.full === "1") : null, cpos = plan ? plan.cpos : "0";
    r.dataset.chat = chatOn ? "1" : "0"; r.dataset.cpos = cpos; e.chat.hidden = !chatOn;
    if(plan && plan.cpos !== "b"){ D.side = plan.cpos; D.sz.max = plan.max; }
    r.style.setProperty("--bd-vpad", (padTop() + padBottom()) + "px");
    paintSz();
    e.cs.hidden = !canShare();
    e.big.setAttribute("aria-label", D.pos.size === "big" ? "Make the window smaller" : "Make the window bigger");
    e.big.innerHTML = D.pos.size === "big" ? ICON.shrink : ICON.big;
    e.min.setAttribute("aria-label", D.bar ? "Show the call again" : "Shrink the window to a bar");
    if(D.bar && s.joined){ e.min.hidden = false; e.min.innerHTML = ICON.big; } else e.min.innerHTML = ICON.small;
    r.style.left = "0"; r.style.top = "0";
    if(mode === "stage" || r.dataset.full === "1"){ r.style.transform = "none"; } else place(false);
    syncVV();
    fitFrame(); geomPing();
  };
  /* a phone's keyboard shrinks the visual screen, not the page: while Messages fills the screen the window follows the visual screen,
     so the message box is always above the keys, and the controls step aside while she types */
  const syncVV = () => {
    const r = D.root; if(!r) return;
    if(isSide()) paintSide();
    const vv = window.visualViewport, big = r.dataset.full === "1" || r.dataset.mode === "stage", on = r.dataset.chat === "1" && big;
    let kb = false;
    if(on && vv){ r.style.top = Math.round(vv.offsetTop) + "px"; r.style.height = Math.round(vv.height) + "px"; kb = innerHeight - vv.height > 120; }
    else { r.style.removeProperty("height"); if(big) r.style.top = "0"; }
    if(on && !kb && touchy() && !D.win && document.activeElement === D.el.ci) kb = true;      /* a narrow window on a desktop is not a phone with its keys up: only a real keyboard (the visual screen shrinking) hides the controls there */
    r.dataset.kb = kb ? "1" : "0";
  };
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const fsCan = () => { try { return !isIphone() && !phone() && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled) && !!(Element.prototype.requestFullscreen || Element.prototype.webkitRequestFullscreen); } catch { return false; } };
  const fsExit = () => { try { const f = document.exitFullscreen || document.webkitExitFullscreen; if(fsEl() && f){ const p = f.call(document); if(p && p.catch) p.catch(() => {}); } } catch {} };
  const fsEnter = async () => { const r = D.root, f = r.requestFullscreen || r.webkitRequestFullscreen; if(!f) throw new Error("no_fullscreen"); const p = f.call(r); if(p && p.then) await p; };
  const expand = () => { D.full = true; applyChrome(); };
  const collapse = () => { D.full = false; applyChrome(); place(true); };

  const names = () => (D.st.people || []).filter(p => p && p.name);
  const firstName = (n) => String(n || "").trim().split(/\s+/)[0];
  /* the status line is always ONE line and is never cut short with dots: the longest wording that fits is used, then shorter ones */
  const fitStat = (words) => {
    const el = D.el.stat; el.textContent = words[0];
    if(D.el.head.hidden || !D.root.offsetWidth) return;
    for(let i = 1; i < words.length && el.scrollWidth > el.clientWidth + 1; i++) el.textContent = words[i];
  };
  const paintHead = () => {
    const e = D.el, s = D.st; if(!s.joined) return;
    paintLogin(); fitFrame();
    const ttl = (D.cfg && D.cfg.title) || "Strategy call"; if(e.title.textContent !== ttl) e.title.textContent = ttl;      /* never the pre-join wording */
    const speaking = names().find(p => p.speaking);
    const call = (D.cfg.getCall && D.cfg.getCall()) || {};
    let mins = call.minutes != null ? call.minutes + Math.floor((Date.now() - (D.t0 || Date.now())) / 60000) : Math.max(0, Math.floor((Date.now() - s.joinedAt) / 60000));
    if(call.started_at){ const m = Math.floor((Date.now() - new Date(call.started_at).getTime()) / 60000); if(isFinite(m) && m >= 0) mins = m; }
    const m = minShort(mins), conn = connecting(), out = s.bridge === "off" && D.login, v = D.v5, five = v.mode === "v5";
    /* round 5: what is happening, in words. Connecting: "In the lobby" (after 45 s: "Still connecting. Check your Wi-Fi."). Nobody else in: "Waiting for <name>". */
    const slow = conn && (v.slow || (D.lobbyT0 && Date.now() - D.lobbyT0 > 45000));
    const others = five ? v.others : names().length, alone = !conn && !out && !s.sharing && others === 0, recon = !conn && !out && five && v.phase === "reconnecting";
    const lobbyW = slow ? ["Still connecting. Check your Wi-Fi.", "Still connecting"] : (five && v.lobbyText ? [v.lobbyText, "In the lobby"] : ["In the lobby"]);
    if(conn) fitStat(lobbyW);          /* no minutes yet: the call has not started for her */
    else if(out) fitStat(cloudLogin() ? ["Not signed in to Bestly Cloud", "Not signed in"] : ["Could not sign you in", "Not signed in"]);
    else if(recon) fitStat([v.lobbyText || "Reconnecting", "Reconnecting"]);
    else if(s.sharing){ const who = s.sharing.me ? "You are" : `${firstName(s.sharing.by) || "Someone"} is`; fitStat([`${who} showing a screen, ${m}`, `${who} sharing, ${m}`, `Sharing, ${m}`]); }
    else if(alone) fitStat(five && v.lobbyText ? [v.lobbyText, waitWords()] : [waitWords(), "Waiting"]);
    else fitStat([`Happening now, ${m}`, `Live now, ${m}`, `Live, ${m}`, "Live"]);      /* a last, short wording: the line is never cut off */
    e.dot.classList.toggle("pulse", conn || recon || alone); e.dot.classList.toggle("on", !conn && !out && !recon && !alone);
    e.tt.textContent = speaking && !alone ? `${speaking.name}` : (conn ? (slow ? "Still connecting" : "In the lobby") : (out ? "Sign in" : (recon ? "Reconnecting" : (alone ? waitWords() : (mins < 1 ? "Just started" : m)))));
    D.el.tile.classList.toggle("live", s.bridge === "ok" && !out);
    /* an older call page draws nothing while you are alone: the cover says who it is waiting for, so the stage is never just black */
    if(D.legacy && !conn && !out && s.bridge === "ok" && D.frameJoined){ waitText(alone ? waitWords() : "In the lobby"); waitOn(alone); }
    const shown = speaking || names()[0] || { name: "·" };
    putFace(e.tav, faceOf(shown), shown.name);
    const showScout = s.scoutSaid === true ? !!s.scout : (!!s.scout || call.scout === true);      /* the frame's flag once it has spoken; before that, the server's own list of who is on the call */
    e.notes.hidden = !showScout; e.tscout.hidden = !showScout;
    D.root.classList.toggle("bd-speak", !!speaking);
    settle();
    notifyFail(); notifyConn();                // the failure first, so the host never sees "not joining any more" without "failed"
  };
  const paintCtl = () => {
    const e = D.el, s = D.st, conn = connecting();
    // the word under a control is one short word, so it never wraps; the whole sentence is its name for a screen reader
    const set = (b, on, icon, word, name) => { b.setAttribute("aria-pressed", String(on)); const ic = b.querySelector(".bd-ci2"); const bd = ic.querySelector(".bd-bd"); ic.innerHTML = icon; if(bd) ic.appendChild(bd); b.querySelector(".bd-cl2").textContent = word; b.setAttribute("aria-label", name); b.title = name; };
    if(conn){
      /* the call has not started yet. Mute and Camera answer at once: what she picks shows now and is applied the moment the call starts
         (until then the frame has said nothing about her). Share cannot begin before the call does, so it stays quiet, and says so when tapped. */
      const wait = ". It takes effect as soon as the call has started.";
      set(e.cm, !!s.muted, s.muted ? ICON.micoff : ICON.mic, s.muted ? "Unmute" : "Mute", (s.muted ? "Unmute yourself" : "Mute yourself") + wait);
      set(e.cc, !s.camera, s.camera ? ICON.cam : ICON.camoff, "Camera", (s.camera ? "Stop camera" : "Start camera") + wait);
      set(e.cs, false, ICON.share, "Share", "Share your screen, ready when the call has started"); e.cs.setAttribute("aria-disabled", "true");
      [e.cm, e.cc].forEach(b => b.removeAttribute("aria-disabled"));
    } else {
      set(e.cm, s.muted, s.muted ? ICON.micoff : ICON.mic, s.muted ? "Unmute" : "Mute", s.muted ? "Unmute yourself" : "Mute yourself");
      set(e.cc, !s.camera, s.camera ? ICON.cam : ICON.camoff, "Camera", s.camera ? "Stop camera" : "Start camera");
      set(e.cs, !!(s.sharing && s.sharing.me), ICON.share, s.sharing && s.sharing.me ? "Stop" : "Share", s.sharing && s.sharing.me ? "Stop sharing your screen" : "Share your screen");
      [e.cm, e.cc, e.cs].forEach(b => b.removeAttribute("aria-disabled"));
    }
    e.cx.setAttribute("aria-pressed", String(s.chatOpen));
    e.badge.hidden = !s.unread; e.badge.textContent = s.unread > 9 ? "9+" : String(s.unread);
    e.cx.setAttribute("aria-label", s.unread ? `Messages, ${s.unread} new` : "Messages"); e.cx.title = "Messages";
  };

  /* ── messages in the window ──────────────────────────────────────── */
  const t12 = (iso) => { try { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).replace(" ", NB); } catch { return ""; } };
  /* the date and the time over a run of messages (Jared, 2026-10-19): Today, 3:05 PM  ·  Yesterday, 7:12 PM  ·  Saturday, Oct 17, 7:12 PM (the year only when it is not this year).
     A number stays with its word, so "Oct 17" and "7:12 PM" never break apart. */
  const dayHead = (iso) => {
    const d = new Date(iso); if(isNaN(d)) return "";
    const now = new Date(), y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), same = (a, b) => a.toDateString() === b.toDateString();
    let day;
    if(same(d, now)) day = "Today"; else if(same(d, y)) day = "Yesterday";
    else { const o = { weekday: "long", month: "short", day: "numeric" }; if(d.getFullYear() !== now.getFullYear()) o.year = "numeric"; day = d.toLocaleDateString("en-US", o).replace(/ (\d)/g, NB + "$1"); }
    return `${day}, ${t12(iso)}`;
  };
  /* A web address in a message is a real link: it opens in a new tab, it is shown in full (never cut with dots), and it can wrap at the slashes,
     question marks and dashes. Only http and https are links. Everything else is plain, escaped text. */
  const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`“”‘’]+/gi;
  const safeHref = (raw) => {
    let u = String(raw == null ? "" : raw).trim(); if(!u) return "";
    if(/^www\./i.test(u)) u = "https://" + u;
    try { const x = new URL(u); return /^https?:$/.test(x.protocol) && x.hostname ? x.href : ""; } catch { return ""; }
  };
  const trimUrl = (s) => {                  // a full stop, comma or closing bracket at the end belongs to the sentence, not the address
    let t = s, tail = "";
    for(;;){
      const c = t.slice(-1);
      if(c && ".,;:!?".includes(c)){ tail = c + tail; t = t.slice(0, -1); continue; }
      if(c === ")" || c === "]" || c === "}"){
        const o = c === ")" ? "(" : c === "]" ? "[" : "{";
        if(t.split(c).length > t.split(o).length){ tail = c + tail; t = t.slice(0, -1); continue; }
      }
      return [t, tail];
    }
  };
  const brk = (u) => {                      // where a long address may wrap: after / ? & = # _ - (the host name stays whole)
    const m = /^(https?:\/\/)?([^\/?#]*)([\s\S]*)$/i.exec(u) || [];
    const head = (m[1] || "") + (m[2] || ""), rest = (m[3] || "").replace(/([\/?&=#_\-])/g, "$1\u0001");
    return esc(head + rest).replace(/\u0001/g, "<wbr>");
  };
  const linkify = (text) => {
    const s = String(text == null ? "" : text); let out = "", at = 0, m;
    URL_RE.lastIndex = 0;
    while((m = URL_RE.exec(s))){
      if(m.index > 0 && /[A-Za-z0-9@]/.test(s[m.index - 1])) continue;          // "awww.x" or "me@www.x" is not a link
      const [u] = trimUrl(m[0]), href = safeHref(u);
      if(!href) continue;
      out += esc(s.slice(at, m.index)) + `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${brk(u)}</a>`;
      at = m.index + u.length; URL_RE.lastIndex = at;
    }
    return out + esc(s.slice(at));
  };
  /* the newest message stays in view while she is reading the end; if she has scrolled up to read, a quiet button says there is more */
  const stickEnd = () => { const b = D.el.cl; b.scrollTop = b.scrollHeight; D.chat.stick = true; if(D.el.cnew) D.el.cnew.hidden = true; };
  const paintEmpty = () => { const c = D.el.cempty; if(c) c.hidden = !(D.chat.loaded && !D.chat.last); };
  const addMsgs = (list) => {
    if(!list || !list.length) return;                                  // nothing new: nothing to repaint
    const e = D.el, box = e.cl, shown = D.root.dataset.chat === "1", wasStuck = D.chat.stick;
    let added = 0, theirs = 0, mine = 0;
    list.forEach(m => {
      if(m.id <= D.chat.last) return; D.chat.last = Math.max(D.chat.last, m.id); added++;
      { const at = new Date(m.at).getTime(), pa = D.chat.lastAt;
        if(!isNaN(at) && (!pa || new Date(pa).toDateString() !== new Date(at).toDateString() || at - pa > 3600e3)){ const h = document.createElement("p"); h.className = "bd-day"; h.textContent = dayHead(m.at); box.appendChild(h); }
        if(!isNaN(at)) D.chat.lastAt = at; }
      const d = document.createElement("div"); d.className = "bd-m" + (m.mine ? " me" : "");
      const fk = faceOf({ name: m.who, mine: !!m.mine, uid: m.uid }), fa = fk && window.BestlyFaces ? `<span class="bd-fa has-face" aria-hidden="true">${window.BestlyFaces.inner(fk)}</span>` : "";
      const fl = m.file && m.file.url ? safeHref(m.file.url) : "", fn = esc((m.file && m.file.name) || "A file");
      d.innerHTML = `<b${fa ? ' class="bd-hasfa"' : ""}>${fa}${esc(m.mine ? "You" : m.who || "")}<small>${esc(t12(m.at))}</small></b><p>${linkify(m.text)}</p>${m.file && m.file.url ? (fl ? `<a class="bd-file" href="${esc(fl)}" target="_blank" rel="noopener noreferrer">${fn}</a>` : `<span class="bd-file">${fn}</span>`) : ""}`;
      box.appendChild(d);
      if(m.mine) mine++; else { theirs++; if(!shown) D.st.unread++; }
    });
    if(!added) return;
    paintEmpty();
    if(shown){
      if(wasStuck || mine) stickEnd(); else if(theirs && e.cnew) e.cnew.hidden = false;
      if(D.chat.last && D.cfg.chat && D.cfg.chat.seen){ D.st.unread = 0; D.cfg.chat.seen(D.chat.last).catch(() => {}); }
    }
    paintCtl();
  };
  const chatStart = async () => {
    if(!D.cfg.chat || D.chat.run) return;
    D.chat.run = true; let bad = 0;
    while(D.chat.run && D.st.joined){
      const t0 = Date.now();
      try{
        const r = await D.cfg.chat.list(D.chat.last || 0, !!D.chat.last);
        if(r && r.ok === false){ if(/unknown action/i.test(String(r.error || "")) || (r.status === 401 && /not[_ ]found/i.test(String(r.error || "")))){ D.cfg.chat = null; D.el.cx.hidden = true; if(D.st.chatOpen){ D.st.chatOpen = false; applyChrome(); paintCtl(); } break; } throw new Error(r.error || "chat"); }
        bad = 0; if(r && r.messages) addMsgs(r.messages);
        if(r && r.ok !== false && !D.chat.loaded){ D.chat.loaded = true; paintEmpty(); }
        if(!D.chat.last) await new Promise(res => setTimeout(res, 1500));
        else if(Date.now() - t0 < 500) await new Promise(res => setTimeout(res, 500 - (Date.now() - t0)));   // a server that answers at once is not asked again at once
      }catch(err){ bad++; if(bad === 3) fault("chat", String(err && err.message || err)); await new Promise(res => setTimeout(res, Math.min(30000, 3000 * bad))); }
    }
    D.chat.run = false;
  };
  /* open and close Messages (the control, the Done button and Escape all come here) */
  const touchy = () => { try { return matchMedia("(pointer: coarse)").matches || phone(); } catch { return phone(); } };
  const setChat = (open, back) => {
    const s = D.st, e = D.el; if(!!open === s.chatOpen) return;
    if(open){
      s.chatOpen = true; s.unread = 0; D.chat.stick = true;
      if(D.chat.last && D.cfg.chat && D.cfg.chat.seen) D.cfg.chat.seen(D.chat.last).catch(() => {});
    } else s.chatOpen = false;
    applyChrome(); paintCtl();
    if(open){
      stickEnd(); requestAnimationFrame(() => { stickEnd(); if(!touchy()){ try { e.ci.focus({ preventScroll: true }); } catch {} } });
      say("Messages are open.");
    } else {
      if(back){ try { e.cx.focus({ preventScroll: true }); } catch {} }
      say("Messages are closed.");
    }
  };

  /* ── the two handles (round 3, N10) ─────────────────────────────────────────────────────────────────────────────
     Width: the panel's free edge (the one facing the board, not the one next to the call window; on the stage its left edge). Drag it (1:1 with the pointer, never past
     300 px or the widest the screen allows), use the left and right arrow keys (16 px, Shift 48 px, Home and End for the ends), double-click or Enter to set it back to 340 px.
     Strip: on a phone (and under a strip of video anywhere) the divider between the video and the chat; the "Bigger chat" grip, or a double-tap on the divider, snaps the strip
     to 120 px, and the same again brings it back. Springs settle without a bounce, can be grabbed at any moment, and "reduce motion" skips them. */
  const stopSp = () => { if(D.sz.sp){ cancelAnimationFrame(D.sz.sp); D.sz.sp = 0; } };
  const cancelSz = () => { stopSp(); cancelAnimationFrame(D.glide); D.glide = 0; D.root.classList.remove("bd-resizing"); unflip(); };
  const springTo = (from, to, apply, done) => {
    stopSp();
    if(reduced() || Math.abs(to - from) < 1){ apply(to); if(done) done(); return; }
    const w0 = 2 * Math.PI / 0.38, t0 = performance.now();          // critically damped, response 0.38 s
    const f = (now) => {
      const t = Math.max(0, now - t0) / 1000, k = (1 + w0 * t) * Math.exp(-w0 * t), v = to + (from - to) * k;
      if(t > 1.2 || Math.abs(v - to) < 0.35){ D.sz.sp = 0; apply(to); if(done) done(); return; }
      apply(v); D.sz.sp = requestAnimationFrame(f);
    };
    D.sz.sp = requestAnimationFrame(f);
  };
  const widthNow = () => Math.max(CW_MIN, Math.min(D.sz.cw, D.sz.max));
  const bodyOf = () => $(".bd-body", D.root);
  const fullish = () => D.root.dataset.full === "1" || D.root.dataset.mode === "stage";
  /* Messages is made wider, narrower, taller or shorter: if she was at the newest message she still is (the list may be re-wrapped, and the browser may nudge it while it does:
     that is not her scrolling, see the scroll listener) */
  const keepEnd = () => { const l = D.el && D.el.cl; if(!l || !D.root || D.root.dataset.chat !== "1") return; D.sz.t = performance.now(); if(D.chat.stick) l.scrollTop = l.scrollHeight; };
  const stripNow = () => Math.round((fullish() ? bodyOf() : D.el.frameBox).getBoundingClientRect().height);
  /* the strip is 120 px to half the screen, and never so tall that the chat is left without room to read a message */
  const stripCap = () => {
    const r = D.root.getBoundingClientRect(), lg = D.el.cl.getBoundingClientRect(), H = innerHeight;
    const other = r.height - lg.height - stripNow(), avail = fullish() ? r.height : H - (padTop() + padBottom());
    return Math.max(STRIP_MIN, Math.min(Math.floor(H / 2), Math.floor(avail - other - 72)));
  };
  const defaultStrip = () => { const r = D.root, had = r.dataset.us; delete r.dataset.us; const v = stripNow(); if(had) r.dataset.us = had; return v; };
  const paintDiv = () => {
    const e = D.el; if(!e.div || !D.root || D.root.dataset.cpos !== "b" || D.root.dataset.chat !== "1") return;
    const now = stripNow(), at = now <= STRIP_MIN + 3, lab = at ? "Smaller chat" : "Bigger chat";
    e.div.setAttribute("aria-valuemin", String(STRIP_MIN)); e.div.setAttribute("aria-valuenow", String(now)); e.div.setAttribute("aria-valuetext", `The video is ${now} pixels tall`);
    e.grip.setAttribute("aria-label", lab); e.grip.title = lab;
  };
  /* the sizes she chose, put on the page (called whenever the layout is chosen) */
  const paintSz = () => {
    const r = D.root, e = D.el, c = r.dataset.cpos, on = r.dataset.chat === "1";
    if(on && (c === "r" || c === "l")){
      if(!D.sz.sp){ D.sz.eff = widthNow(); r.style.setProperty("--bd-cw", D.sz.eff + "px"); }
      e.sz.dataset.edge = (r.dataset.mode === "stage" || c === "l") ? "l" : "r";
      e.sz.setAttribute("aria-valuemin", String(CW_MIN)); e.sz.setAttribute("aria-valuemax", String(D.sz.max));
      e.sz.setAttribute("aria-valuenow", String(Math.round(D.sz.eff))); e.sz.setAttribute("aria-valuetext", `${Math.round(D.sz.eff)} pixels wide`);
    } else r.style.removeProperty("--bd-cw");
    if(on && c === "b" && (D.sz.strip != null || D.sz.sp)){ r.dataset.us = "1"; if(!D.sz.sp) r.style.setProperty("--bd-us", Math.round(D.sz.strip * innerHeight) + "px"); }
    else { delete r.dataset.us; r.style.removeProperty("--bd-us"); }
    if(on && c === "b") requestAnimationFrame(paintDiv);
    if(isSide()) paintSide();
    keepEnd();
  };
  const setCw = (px, commit) => {
    stopSp();
    D.sz.cw = Math.round(Math.max(CW_MIN, Math.min(px, D.sz.max)));
    paintSz();
    if(commit) saveSz();
  };
  const resetCw = () => {
    const to = Math.max(CW_MIN, Math.min(CW, D.sz.max)), from = D.sz.eff;
    D.sz.cw = to; saveSz();
    springTo(from, to, (v) => { D.sz.eff = v; D.root.style.setProperty("--bd-cw", v + "px"); keepEnd(); }, () => paintSz());
    say("Messages is back to its usual width.");
  };
  const wireSz = () => {
    const h = D.el.sz; let drag = null, tapT = 0, tapX = 0;
    const sign = () => (h.dataset.edge === "r" ? 1 : -1);            // the handle on the right edge: moving it right makes the panel wider; on the left edge: moving it left does
    h.addEventListener("pointerdown", (ev) => {
      if(ev.button != null && ev.button !== 0) return;
      ev.preventDefault(); stopSp();
      drag = { id: ev.pointerId, x0: ev.clientX, w0: D.sz.eff, moved: 0 };
      try { h.setPointerCapture(ev.pointerId); } catch {}
      D.root.classList.add("bd-resizing"); h.classList.add("on");
      try { h.focus({ preventScroll: true }); } catch {}
    });
    h.addEventListener("pointermove", (ev) => {
      if(!drag || ev.pointerId !== drag.id) return;
      const dx = ev.clientX - drag.x0; drag.moved = Math.max(drag.moved, Math.abs(dx));
      if(drag.moved >= 3) setCw(drag.w0 + sign() * dx, false);
    });
    const end = (ev) => {
      if(!drag || (ev && ev.pointerId !== drag.id)) return;
      const d = drag; drag = null; try { h.releasePointerCapture(d.id); } catch {}
      D.root.classList.remove("bd-resizing"); h.classList.remove("on");
      if(d.moved >= 3){ saveSz(); tapT = 0; say(`Messages is ${Math.round(D.sz.eff)} pixels wide.`); return; }
      if(!ev || ev.type !== "pointerup") return;
      const now = performance.now();
      if(now - tapT < 400 && Math.abs(ev.clientX - tapX) < 10){ tapT = 0; resetCw(); } else { tapT = now; tapX = ev.clientX; }       // two quick taps (a double-click)
    };
    h.addEventListener("pointerup", end); h.addEventListener("pointercancel", end);
    h.addEventListener("keydown", (ev) => {
      const k = ev.key, step = ev.shiftKey ? 48 : 16; let v = null;
      if(k === "ArrowRight") v = D.sz.eff + sign() * step; else if(k === "ArrowLeft") v = D.sz.eff - sign() * step;
      else if(k === "Home") v = CW_MIN; else if(k === "End") v = D.sz.max;
      else if(k === "Enter"){ ev.preventDefault(); ev.stopPropagation(); resetCw(); return; }
      if(v == null) return;
      ev.preventDefault(); ev.stopPropagation(); setCw(v, true); say(`Messages is ${Math.round(D.sz.eff)} pixels wide.`);
    });
  };
  const setStrip = (px, cap, commit) => {
    stopSp();
    const v = Math.round(Math.max(STRIP_MIN, Math.min(px, cap)));
    D.sz.strip = v / innerHeight; D.root.dataset.us = "1"; D.root.style.setProperty("--bd-us", v + "px"); keepEnd();
    if(commit) saveSz();
    return v;
  };
  const toggleStrip = () => {
    const now = stripNow(), cap = stripCap(); let to;
    if(now > STRIP_MIN + 3){ D.sz.back = now; to = STRIP_MIN; say("The video is as small as it goes, and the chat has the rest."); }
    else { to = Math.min(D.sz.back || defaultStrip(), cap); D.sz.back = 0; say("The video is back to its usual size."); }
    D.root.style.setProperty("--bd-us", now + "px"); D.root.dataset.us = "1";      // the variable first: with the mark on and no value the strip would flash to its usual size for a frame
    springTo(now, to, (v) => { D.root.style.setProperty("--bd-us", v + "px"); keepEnd(); }, () => { D.sz.strip = to / innerHeight; D.root.style.setProperty("--bd-us", to + "px"); saveSz(); paintDiv(); });
  };
  const wireDiv = () => {
    const e = D.el; let drag = null, tapT = 0, tapX = 0, tapY = 0;
    const down = (ev) => {
      if(ev.button != null && ev.button !== 0) return;
      ev.preventDefault(); stopSp();
      drag = { id: ev.pointerId, el: ev.currentTarget, y0: ev.clientY, s0: stripNow(), cap: stripCap(), moved: 0 };
      try { drag.el.setPointerCapture(ev.pointerId); } catch {}
      D.root.classList.add("bd-resizing", "bd-resizing-y");
    };
    const move = (ev) => {
      if(!drag || ev.pointerId !== drag.id) return;
      const dy = ev.clientY - drag.y0; drag.moved = Math.max(drag.moved, Math.abs(dy));
      if(drag.moved >= 6) setStrip(drag.s0 + dy, drag.cap, false);
    };
    const up = (ev) => {
      if(!drag || (ev && ev.pointerId !== drag.id)) return;
      const d = drag; drag = null; try { d.el.releasePointerCapture(d.id); } catch {}
      D.root.classList.remove("bd-resizing", "bd-resizing-y");
      if(d.moved >= 6){ saveSz(); paintDiv(); tapT = 0; say(`The video is ${stripNow()} pixels tall.`); return; }
      if(!ev || ev.type !== "pointerup") return;
      if(d.el === e.grip){ tapT = 0; toggleStrip(); return; }                       // a tap on the grip
      const now = performance.now();
      if(now - tapT < 400 && Math.hypot(ev.clientX - tapX, ev.clientY - tapY) < 24){ tapT = 0; toggleStrip(); } else { tapT = now; tapX = ev.clientX; tapY = ev.clientY; }      // a double-tap on the divider
    };
    [e.div, e.grip].forEach(el => { el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); });
    e.grip.addEventListener("click", (ev) => { if(ev.detail === 0) toggleStrip(); });                // from the keyboard (a tap or a click is handled above)
    e.div.addEventListener("focus", paintDiv); e.grip.addEventListener("focus", paintDiv);
    e.div.addEventListener("keydown", (ev) => {
      const k = ev.key, step = ev.shiftKey ? 48 : 16; let v = null;
      if(k === "Enter" || k === " "){ ev.preventDefault(); ev.stopPropagation(); toggleStrip(); return; }
      const now = stripNow(), cap = stripCap();
      if(k === "ArrowUp") v = now - step; else if(k === "ArrowDown") v = now + step; else if(k === "Home") v = STRIP_MIN; else if(k === "End") v = cap;
      if(v == null) return;
      ev.preventDefault(); ev.stopPropagation(); setStrip(v, cap, true); paintDiv(); say(`The video is ${stripNow()} pixels tall.`);
    });
  };

  /* ── buttons ─────────────────────────────────────────────────────── */
  const openTab = async () => {
    try{ const t = await D.cfg.ticket(); if(t && t.url){ window.open(t.url, "_blank"); return; } throw new Error("no_url"); }
    catch(err){ fault("tab_ticket", String(err && err.message || err)); say("We could not open the call in a new tab. Please try again."); }
  };
  const hint = (txt) => {
    const h = D.el.hint; if(!h) return;
    h.textContent = txt; h.hidden = false; h.classList.remove("on"); void h.offsetWidth; h.classList.add("on");
    clearTimeout(D.timers.hint); D.timers.hint = setTimeout(() => { h.hidden = true; }, 4200); say(txt);
  };
  const wireButtons = () => {
    const e = D.el;
    e.pm.onclick = () => { D.pre.mic = !D.pre.mic; if(D.pre.stream) D.pre.stream.getAudioTracks().forEach(t => t.enabled = D.pre.mic); if(D.v5.mode === "v5") post(D.pre.mic ? "unmute" : "mute"); paintPre(); };
    e.pc.onclick = () => { D.pre.cam = !D.pre.cam; if(D.pre.stream) D.pre.stream.getVideoTracks().forEach(t => t.enabled = D.pre.cam); if(D.v5.mode === "v5") post(D.pre.cam ? "camera-on" : "camera-off"); D.root.classList.toggle("bd-nocam", !D.pre.cam || isIOS()); paintPre(); };
    e.join.onclick = () => { winTapped(); join(false); };
    e.join2.onclick = () => { winTapped(); join(true); };
    /* round 5: the camera was refused. Try again builds a fresh call page (the browser's setting may have changed), which asks again. */
    e.pretry.onclick = () => { if(!D.st.open || D.st.joined) return; unwarm(); D.v5 = freshV5(D.legacy ? "legacy" : "pending"); D.el.call.hidden = !v5on(); paintPre(); waitOn(true); warm(); say("Trying again."); };
    $(".bd-retry", D.root).onclick = () => { D.el.err.hidden = true; D.el.frameBox.hidden = false; D.el.call.hidden = true; D.el.pre.hidden = false; setMode("prejoin"); startPre(); paintPre(); warm(); };
    $(".bd-tab", D.root).onclick = openTab; $(".bd-tab2", D.root).onclick = openTab;
    D.el.wlogin.onclick = () => signIn();
    let again = false;
    D.el.wagain.onclick = async () => {
      if(!D.frame || again) return;
      const f = D.frame; let url = ""; again = true;
      try {
        if(!cloudLogin()){
          try { const t = await D.cfg.ticket(); if(!t || !t.url) throw new Error((t && t.error) || "no_url"); url = t.url; D.origin = origin(url); }
          catch(err){ fault("ticket", String(err && err.message || err)); hint("We could not try again just now. Please tap Try again in a moment."); return; }
          if(D.frame !== f || !D.st.joined) return;                                   // she left while the ticket was on its way
        }
        D.login = false; D.signing = false; D.el.warn.hidden = true; D.st.bridge = "wait"; D.root.dataset.bridge = "wait"; D.frameJoined = false; waitOn(true); armBridge(T.bridge);
        try { if(url) { url = withBv(url); D.callUrl = url; f.src = url; } else f.src = D.callUrl || f.src; } catch {}      /* the CALL page: the frame may be on the sign-in page now */
        paintCtl(); paintHead();
      } finally { again = false; }
    };
    e.dev.onclick = () => { e.devs.hidden = !e.devs.hidden; };
    e.dc.onchange = e.dm.onchange = () => startPre();
    e.close.onclick = () => { post("preview-stop"); stopPre(); unwarm(); D.root.hidden = true; D.st.open = false; document.documentElement.classList.remove("bd-stage"); geomPing(); };
    /* tapped while the call is still starting: it shows at once and is applied when the call has started (see D.want in onMsg) */
    const early = (what) => {
      const s = D.st; D.want = D.want || { mute: !!s.muted, cam: !!s.camera };
      if(what === "mute"){ s.muted = !s.muted; D.want.mute = s.muted; D.want.mset = true; say(s.muted ? "Your microphone will be off when the call starts." : "Your microphone will be on when the call starts."); }
      else { s.camera = !s.camera; D.want.cam = s.camera; D.want.cset = true; say(s.camera ? "Your camera will be on when the call starts." : "Your camera will be off when the call starts."); }
      paintCtl();
    };
    e.cm.onclick = () => { if(connecting()) early("mute"); else post(D.st.muted ? "unmute" : "mute"); };
    e.cc.onclick = () => { if(connecting()) early("cam"); else post(D.st.camera ? "camera-off" : "camera-on"); };
    e.cs.onclick = () => { if(connecting()) hint("Sharing your screen works once the call has started."); else post(D.st.sharing && D.st.sharing.me ? "share-stop" : "share-start"); };
    e.cv.onclick = () => { D.leaving = true; leave(); setTimeout(() => { D.leaving = false; }, 1500); };
    e.cx.onclick = () => setChat(!D.st.chatOpen, false);
    e.cdone.onclick = () => setChat(false, true);
    e.cnew.onclick = () => { stickEnd(); try { e.ci.focus({ preventScroll: true }); } catch {} };
    e.cl.addEventListener("scroll", () => { if(e.cl.clientHeight !== D.chat.ch || performance.now() - D.sz.t < 200) return; /* the list changed size (the keys came up, Messages was made wider or narrower): that is not her scrolling */ const at = e.cl.scrollHeight - e.cl.scrollTop - e.cl.clientHeight < 48; D.chat.stick = at; if(at) e.cnew.hidden = true; }, { passive: true });
    /* the log changed size (the window grew, the keys came up): if she was at the end she still is */
    if(window.ResizeObserver) new ResizeObserver(() => { D.chat.ch = e.cl.clientHeight; if(D.chat.stick && D.root.dataset.chat === "1") e.cl.scrollTop = e.cl.scrollHeight; }).observe(e.cl);
    e.ci.addEventListener("focus", () => syncVV()); e.ci.addEventListener("blur", () => setTimeout(() => { if(document.activeElement !== e.ci) syncVV(); }, 150));
    e.cf.onsubmit = async (ev) => {
      ev.preventDefault(); const v = e.ci.value.trim(); if(!v || !D.cfg.chat) return;
      e.ci.value = ""; e.ci.disabled = true;
      try{ const r = await D.cfg.chat.send(v); if(!r || r.ok === false) throw new Error((r && r.error) || "send"); const t = new Date().toISOString(); D.chat.stick = true; addMsgs([{ id: r.id || (D.chat.last + 1), mine: true, who: "You", text: v, at: t }]); }
      catch(err){ e.ci.value = v; say("That message did not send. Please try again."); fault("chat_send", String(err && err.message || err)); }
      e.ci.disabled = false; e.ci.focus();
    };
    e.min.onclick = () => { D.bar = !D.bar; applyChrome(); place(true); };
    e.big.onclick = () => { D.pos.size = D.pos.size === "big" ? "normal" : "big"; save(); applyChrome(); setTimeout(() => place(true), 0); };
    e.fill.onclick = () => { if(D.root.dataset.full === "1"){ collapse(); say("The call is a small window again."); try{ D.el.tile.focus({ preventScroll: true }); }catch{} } else expand(); };
    e.fs.onclick = async () => { try{ await fsEnter(); }catch(err){ fault("fullscreen", String(err && err.message || err)); say("Full screen did not open. The window stays as it is."); } };
    ["fullscreenchange", "webkitfullscreenchange"].forEach(ev => document.addEventListener(ev, () => { const was = D.dfull; D.dfull = fsEl() === D.root; if(was !== D.dfull && D.st.joined){ applyChrome(); place(true); say(D.dfull ? "The call fills the screen." : "The call is back in its window."); } }));
    e.pop.onclick = () => popOut(); e.pshow.onclick = () => { const p = D.pop; if(p.ncOffer && !p.joined){ const u2 = p.ncUrl || plainUrl(); if(u2){ try { window.open(u2, "_blank"); } catch {} } return; } popFocus(); }; e.pback.onclick = () => { if(D.pop.joined) popBack(); else popCancel("Your call is back here."); };
    ["pointerenter", "focus", "touchstart", "pointerdown"].forEach(ev => e.pop.addEventListener(ev, () => { if(!D.pop.on && popOk()){ if(sepOk()) popCode(); else popSpare(); } }, { passive: true }));
    e.small.onclick = () => { if(D.dfull){ fsExit(); return; } D.st.stageOff = true; applyChrome(); paintHead(); place(true); say("The call window is small again."); };
    e.tile.onclick = (ev) => { /* a tap that was not a drag opens the full screen call (the pointer-up does it first; this one is for a browser that gave only the click) */ if(phone() && D.st.mode === "tile" && D.tapOk !== false) expand(); };
    $(".bd-tile", D.root).addEventListener("keydown", (ev) => { if(ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); expand(); } });
    D.root.addEventListener("keydown", (ev) => {
      if(ev.key !== "Escape") return;
      if(D.st.chatOpen && D.root.dataset.chat === "1"){ ev.stopPropagation(); setChat(false, true); return; }      // Escape closes Messages first
      if(D.full && D.st.joined) collapse();
    });
  };

  /* ── a live call never leaves the page (round 5, P4) ─────────────────────────────────────────────────────────── */
  const callLive = () => !!D.st.joined || !!(D.pop.on && D.pop.joined);      /* in the call here, or in its own window */
  const armNav = () => {
    /* a link that would replace the page opens in a new tab instead (a link the page handles itself, a #address, a download, mailto: and tel: are left alone) */
    addEventListener("click", (ev) => {
      if(ev.defaultPrevented || !callLive() || ev.button > 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      const a = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
      if(!a || a.hasAttribute("download") || (D.root && D.root.contains(a))) return;
      if(a.target && a.target !== "_self"){ if(/^https?:$/.test(a.protocol || "")) note("That page opened in a new tab. Your call stays in this tab."); return; }
      let u; try { u = new URL(a.getAttribute("href"), location.href); } catch { return; }
      if(!/^https?:$/.test(u.protocol)) return;
      if(u.origin === location.origin && u.pathname === location.pathname && u.search === location.search) return;
      ev.preventDefault();
      try { window.open(u.href, "_blank", "noopener"); } catch {}
      note("That page opened in a new tab. Your call stays in this tab.");
    }, false);
    /* a reload, a pulled page or a closed tab would drop the call: the browser asks first (iPhone Safari never asks, so there the page simply never navigates by itself) */
    addEventListener("beforeunload", (ev) => { if(callLive() && D.frameJoined && !D.win){ ev.preventDefault(); ev.returnValue = ""; return ""; } });
  };

    /* ── the call in its own window: Pop out (2026-10-27, Eli) ────────────────────────────────────────────────────────
     Pop out opens the host's own window (cfg.winUrl: /callwin on the board, /?callwin=1 in Studio): the same app, only the call, filling that window.
     It joins there with the same microphone and camera, and only when that window says it is in the call does THIS page leave, so the call never drops.
     This page then shows a small card, "Call in its own window", with Show it and Bring it back. The pages talk over BroadcastChannel("bestly-call")
     (same address, nothing secret). Closing the window leaves the call. If the window never gets in, the call stays here. */
  const BC = (() => { try { return typeof BroadcastChannel === "function" ? new BroadcastChannel("bestly-call") : null; } catch { return null; } })();
  const WINNAME = "bestly-call";
  Object.assign(D, { win: false, winSaid: false, winLeft: false, winGo: false, winTk: null, winO: null, pop: { on: false, w: null, t: 0, beat: 0, joined: false, back: false, mic: true, cam: true, bt: 0, fail: false, shown: "", tk: null, sep: false, hc: null, busy: false, pk: 0, live: false } });
  const winSend = (o) => {      /* the other window hears it on the channel, and also straight from the page that opened it (a window of the Dock app has an opener) */
    const m = Object.assign({ k: String((D.cfg && D.cfg.winKind) || "page"), i: Math.random().toString(36).slice(2) }, o);
    try { if(BC) BC.postMessage(m); } catch {}
    try { const w = D.win ? window.opener : (D.pop && D.pop.w); if(w && w !== window && !w.closed) w.postMessage({ bestlyWin: m }, location.origin); } catch {}
  };
  /* a short line the person can see (the host's toast), and the screen reader hears it too */
  const note = (txt) => { let shown = false; try { if(D.cfg && typeof D.cfg.toast === "function"){ D.cfg.toast(txt); shown = true; } } catch {} if(!shown){ try { hint(txt); } catch {} } say(txt); };
  const popOk = () => { try { return !D.win && !phone() && !isIOS() && !!D.cfg && typeof D.cfg.winUrl === "function" && (typeof D.cfg.winOk !== "function" || !!D.cfg.winOk()); } catch { return false; } };
  const popFocus = () => {
    let w = null; try { w = D.pop.w && !D.pop.w.closed ? D.pop.w : (D.pop.on && !D.pop.sep ? window.open("", WINNAME) : null); } catch {}
    try { if(w) w.focus(); } catch {}
    winSend({ t: "cmd", c: "focus" });
  };
  /* What the card says while the new window is on its way (Jared, 2026-10-27): one line at a time, each replacing the one before with a soft 200 ms crossfade.
     The seconds are counted from the tap (Bring it back: from its own tap). At 90 s the call stays here and the card says so. */
  const POPSAY = [[0, "Moving the call to its own window"], [3, "Opening the window"], [6, "Still working"], [10, "Connecting the call"], [15, "Almost there"], [22, "Jared swears this works"], [30, "Oh my goodness"], [40, "Oh my god"], [55, "Hang on, still trying"], [75, "Giving it a few more seconds"]];
  const POPFAIL = "The new window didn't connect. Your call is back here.", POPOWN = "Call in its own window";
  const pstSay = (txt) => {
    const ls = D.el.pls, p = D.pop; if(!ls || ls.length < 2 || p.shown === txt) return;
    p.shown = txt;
    const on = ls[0].classList.contains("on") ? 0 : (ls[1].classList.contains("on") ? 1 : -1), nx = ls[on === 0 ? 1 : 0];
    nx.textContent = txt; nx.classList.add("on"); if(on >= 0) ls[on].classList.remove("on");
  };
  const popLine = () => {
    const p = D.pop; if(p.fail) return POPFAIL;
    if(p.ncOffer && !p.joined) return "Open your call in Bestly Cloud";
    if(p.ncg && !p.joined && !p.back) return "Opening your call in Bestly Cloud";
    if(p.tap && !p.joined && !p.back) return "Tap Start the call in the new window";
    if(p.joined && !p.back) return p.nc ? "Your call is in the Bestly Cloud window" : POPOWN;
    const secs = (Date.now() - (p.back ? p.bt : p.t)) / 1000; let w = p.sep && !p.back ? "Opening the call in Safari" : POPSAY[0][1];      /* from the Dock app the window opens in Safari */
    for(const [s, x] of POPSAY) if(secs >= s && !(s === 0 && p.sep && !p.back)) w = x;
    return p.back && w === POPSAY[0][1] ? "Bringing the call back" : w;
  };
  const popPaint = () => {
    const p = D.pop, e = D.el; if(!e.pst) return;
    pstSay(popLine());
    const lab = e.pback.querySelector("span"), t = p.joined ? "Bring it back" : "Keep it here";
    if(lab && lab.textContent !== t) lab.textContent = t;
    { const sl = e.pshow.querySelector("span") || e.pshow, st = p.ncOffer && !p.joined ? "Open in Bestly Cloud" : "Show it"; if(sl.textContent !== st && !sl.querySelector("svg")) sl.textContent = st; }
    e.pshow.disabled = !!p.fail; e.pback.disabled = !!p.fail || !!p.back || !!p.lv;
  };
  /* a ticket for the new window, asked for early (a hover, a touch, the tap itself) and handed over on the channel, so the window never has to ask for one.
     Tickets are short-lived: one older than 30 s is asked for again. */
  const stateText = () => { try {
    const me = ((D.cfg && D.cfg.me && D.cfg.me()) || {}).name || "", oth = D.cfg && D.cfg.names ? String(D.cfg.names() || "") : "", who = [firstName(me), oth].filter(Boolean).join(" and ");
    return who ? `${who} ${/ and /.test(who) ? "are" : "is"} in the call` : "In the call";
  } catch { return ""; } };
  const popSpare = () => {
    const k = D.pop.tk, now = Date.now();
    if(k && !k.bad && now - k.t < 30000) return k.p;
    const n = { t: now, v: null, bad: false, p: null };
    n.p = Promise.resolve().then(() => D.cfg.ticket()).then((v) => { if(!v || !v.url) throw new Error("no_url"); n.v = v; return v; }).catch(() => { n.bad = true; return null; });
    D.pop.tk = n; return n.p;
  };
  const popTicketSend = async () => {
    const p = D.pop; if(!p.on || p.joined || p.fail || !p.w) return;
    const v = await popSpare();
    if(v && D.pop.on && !D.pop.joined && !D.pop.fail) winSend({ t: "cmd", c: "ticket", tk: v });
  };
  const getTicket = () => { const k = D.win && D.winTk; if(k){ D.winTk = null; return Promise.resolve(k); } return D.cfg.ticket(); };      /* the call window uses the ticket it was sent; every other page asks */
  const popEnd = () => {      /* the window is gone (closed, or it left): this page is "not on the call" again */
    const p = D.pop; if(!p.on) return;
    clearInterval(D.timers.pop); clearTimeout(D.timers.popb);
    Object.assign(p, { on: false, w: null, joined: false, back: false, fail: false, shown: "" });
    D.root.hidden = true; D.st.open = false; document.documentElement.classList.remove("bd-stage"); geomPing();
    try { D.cfg.onChange && D.cfg.onChange(false); } catch {}
    say("The call window was closed.");
  };
  const popReturn = () => {      /* this page joins the call again, with the same microphone and camera: after Bring it back, or when the new window did not connect. The window has already left (or been told to). */
    const p = D.pop; if(!p.on) return;
    clearInterval(D.timers.pop); clearTimeout(D.timers.popb); clearTimeout(D.timers.popf);
    try { p.w && p.w.close(); } catch {}
    const mic = p.mic, cam = p.cam;
    Object.assign(p, { on: false, w: null, joined: false, back: false, fail: false, shown: "", rj: false, rjw: null, lv: false, nav: 0 });
    fault("pop_rejoin", "mic=" + (mic !== false ? 1 : 0) + "|cam=" + (cam !== false ? 1 : 0) + "|n=" + Math.random().toString(36).slice(2, 6));
    window.BestlyDock.open(); D.pre.mic = mic !== false; D.pre.cam = cam !== false; join(!D.pre.cam);
  };
  const popCancel = (why, fail) => {      /* the window never got into the call (it failed, closed, or Keep it here): it is told to leave and given a moment to finish, then THIS page joins again. One seat at a time. */
    const p = D.pop; if(!p.on || p.joined || p.rj) return; p.rj = true;
    clearInterval(D.timers.pop);
    if(fail){ p.fail = true; popPaint(); say(POPFAIL); }
    winSend({ t: "cmd", c: "leave" });
    const go = () => { clearTimeout(D.timers.popf); p.rjw = null; if(!D.pop.on) return; note(why || POPFAIL); popReturn(); };
    p.rjw = go; clearTimeout(D.timers.popf); D.timers.popf = setTimeout(go, 3500);
  };
  const popFail = (why) => {      /* nojoin: the window says it is not connecting. Anything else = 20 s with no Talk-level join: either way this page takes the call back */
    const p = D.pop; if(!p.on || p.joined || p.rj) return;
    if(why !== "nojoin") fault("pop_timeout", "no join 20 s after the window loaded|msgs=" + (p.logged ? 1 : 0) + "|via=" + (p.via || "none") + "|n=" + Math.random().toString(36).slice(2, 6));
    else fault("pop_nojoin", "said=nojoin|via=" + (p.via || "none") + "|n=" + Math.random().toString(36).slice(2, 6));
    popCancel(POPFAIL, true);
  };
  const popWatch = () => {
    clearInterval(D.timers.pop);
    D.timers.pop = setInterval(() => {
      const p = D.pop; if(!p.on){ clearInterval(D.timers.pop); return; }
      if(p.rj) return;
      let gone = false; try { gone = !!(p.w && p.w.closed) && (!p.sep || p.beat > 0); } catch {}      /* a window in another browser cannot be seen: only trust "closed" once it has spoken */
      if(!gone && p.joined && !p.nc && p.beat && Date.now() - p.beat > 15000) gone = true;      /* a window that crashed stops its heartbeat */
      if(gone){
        if(!p.joined){ p.rj = true; clearInterval(D.timers.pop); setTimeout(() => { if(D.pop.on){ note("The new window was closed. Your call is back here."); popReturn(); } }, 1500); }      /* a moment for a closing window to finish its leave */
        else if(p.back) popReturn(); else popEnd();
        return;
      }
      if(!p.joined && !p.fail && p.nav && Date.now() - p.nav > 20000){ popFail("timeout"); return; }      /* the window loaded the call page and did not get in */
      popPaint();
    }, 1000);
    popPaint();
  };
  const sepOk = () => standalone() && !!(D.cfg && typeof D.cfg.handoff === "function");      /* the Dock app: the new window opens in another browser, with none of this page's sign-ins */
  /* a one-time code (60 s, single use) that signs the other browser's window in; asked for early, like the ticket */
  const popCode = () => {
    const k = D.pop.hc, now = Date.now();
    if(k && !k.bad && now - k.t < 40000) return k.p;
    const n = { t: now, v: null, bad: false, p: null };
    n.p = Promise.resolve().then(() => D.cfg.handoff()).then((c) => { if(!c || typeof c !== "string") throw new Error("no_code"); n.v = c; return c; }).catch(() => { n.bad = true; return null; });
    D.pop.hc = n; return n.p;
  };
  /* waits for the call page to say it has left (the same words the leave button ends with), 3 s at most */
  const popLeaveOpener = () => new Promise((res) => {
    const t0 = Date.now(); D.leaving = true;
    waitLeft(() => {
      fault("pop_leave", "ms=" + (Date.now() - t0) + "|n=" + Math.random().toString(36).slice(2, 6));
      leave(true, true); setTimeout(() => { D.leaving = false; }, 2500);
      setTimeout(res, 400);      /* the frame is torn down before the window loads the call page */
    });
    post("leave");
  });
  const popOut = () => {
    if(!D.st.joined || D.pop.on || D.pop.busy || !popOk()) return;
    let u; try { u = new URL(D.cfg.winUrl(), location.href); } catch { return; }
    u.searchParams.set("m", D.st.muted ? "0" : "1"); u.searchParams.set("c", D.st.camera ? "1" : "0");
    const sep = sepOk();
    let w = null;
    if(!sep){      /* the window is opened empty, inside the tap (so the pop-up blocker lets it through); it loads the call page only after this page has left */
      try { w = window.open("", WINNAME, "popup=yes,width=960,height=640"); } catch {}
      if(!w){ note("Your browser blocked the new window. Allow pop-ups for this site, then tap again."); return; }
      try { w.document.title = "Strategy call"; w.document.body.style.cssText = "margin:0;background:#1F1D1B"; w.focus(); } catch {}
    }
    D.stText = stateText();
    Object.assign(D.pop, { on: true, w, sep, t: Date.now(), nav: 0, beat: 0, joined: false, back: false, bt: 0, fail: false, shown: "", pk: 0, live: false, nc: false, ncOffer: false, ncUrl: "", logged: false, via: "", ncg: false, tap: false, rj: false, rjw: null, lv: true });
    try { const lu = new URL(u.href); lu.searchParams.delete("h"); fault("pop_open", lu.pathname + lu.search + "|w=" + (w ? 1 : 0) + "|sep=" + (sep ? 1 : 0) + "|bc=" + (BC ? 1 : 0) + "|st=" + (standalone() ? 1 : 0) + "|order=leave-first|n=" + Math.random().toString(36).slice(2, 6)); } catch {}
    applyChrome(); popWatch(); say(popLine());      /* the card is up at once */
    popSpare();      /* the new window's ticket is asked for now */
    const codeP = sep ? popCode() : Promise.resolve(null);
    Promise.all([popLeaveOpener(), codeP]).then(([, code]) => {
      const p = D.pop; p.lv = false; if(!p.on || p.rj) return;
      if(sep){
        if(code) u.searchParams.set("h", code);
        let w2 = null; try { w2 = window.open(u.href, WINNAME, "popup=yes,width=960,height=640"); } catch {}
        p.w = w2;
      } else {
        if(!p.w || p.w.closed) return;      /* popWatch takes it from here: this page joins again */
        try { p.w.location.replace(u.href); } catch { try { p.w.location.href = u.href; } catch {} }
      }
      p.nav = Date.now(); fault("pop_nav", "after=" + Math.round((p.nav - p.t) / 100) / 10 + "s|n=" + Math.random().toString(36).slice(2, 6));
      popPaint();
    });
  };
  const popBack = () => {
    const p = D.pop; if(!p.on || !p.joined) return;
    if(p.nc){ if(p.sep) note("Close the Bestly Cloud window to leave the call there."); popReturn(); return; }      /* that window is on the plain Bestly Cloud page and cannot hear: close it if we can, and rejoin here */
    p.back = true; p.bt = Date.now(); popPaint(); winSend({ t: "cmd", c: "leave" });
    clearTimeout(D.timers.popb); D.timers.popb = setTimeout(() => { if(D.pop.on && D.pop.back) popReturn(); }, 5000);      /* the window did not answer: take the call back anyway */
  };
  /* Pop out round 5 (2026-10-27): the call window leaves a trace (which build ran, where it got stuck) and can never dead-end.
     20 s after it loaded and not in the call, it hands itself to the plain Bestly Cloud call page (first-party, so the browser's own sign-in works there). */
  const pvTag = () => { try { const m = /PREVIEW · ([0-9a-f]{8})/.exec(document.body.textContent || ""); return m ? m[1] : "live"; } catch { return "?"; } };
  const hostPath = (u) => { try { const x = new URL(u, location.href); return x.host + "/" + (x.pathname.split("/")[1] || ""); } catch { return ""; } };      /* never a token or a room */
  const plainOf = (u) => { try { if(!u) return ""; const x = new URL(u, location.href); x.searchParams.delete("embed"); x.searchParams.delete("bv"); return x.href; } catch { return ""; } };
  const plainUrl = () => plainOf(D.callUrl);
  const tr = { q: [], n: 0, last: 0, rows: 0, snap: "", t0: Date.now(), permT: 0, loginT: 0 };
  const traceFlush = () => {
    let ok = false; try { ok = !!(D.cfg && D.cfg.session && D.cfg.session()); } catch {}
    if(!ok) return;
    while(tr.q.length){ const x = tr.q.shift(); fault(x[0], x[1]); }
  };
  const traceSend = (code, detail) => { tr.q.push([code, String(detail) + "|n=" + (++tr.n) + "|" + Math.round((Date.now() - tr.t0) / 1000) + "s"]); traceFlush(); };
  const traceSnap = () => {
    const v = D.v5 || {};
    return "ph=" + (v.phase || "") + " pm=" + (v.perm || "") + " br=" + D.st.bridge + " jn=" + (D.st.joined ? 1 : 0) + " fj=" + (D.frameJoined ? 1 : 0) + " lg=" + (D.login ? 1 : 0) + (D.signing ? "s" : "") + " w=" + D.warm.state + " fr=" + (D.frame ? 1 : 0) + " tk=" + (D.winTk ? 1 : 0) + " vs=" + (document.hidden ? "h" : "v") + " oth=" + (v.others || 0) + " u=" + hostPath(D.callUrl);
  };
  const traceTick = () => {
    const now = Date.now(); traceFlush(); winAnnounce();      /* a camera question answered without a new message from the call page */
    if(now - tr.t0 > 120000 && !tr.q.length){ clearInterval(D.timers.trace); return; }
    if(now - tr.t0 <= 90000 && tr.rows < 12 && now - tr.last >= 1000){
      const s = traceSnap();
      if(s !== tr.snap){ tr.snap = s; tr.last = now; tr.rows++; traceSend("win_phase", s); }
    }
    if(D.winSaid || D.winLeft || !(D.win || D.winO)) return;
    const v = D.v5 || {};
    /* the sign-in card is already up for a report of "signed out" (giveUp login); a window that stays on it for 10 s, or whose camera was refused for 3 s, does not get better by waiting */
    if(D.login && !D.signing){ if(!tr.loginT) tr.loginT = now; else if(now - tr.loginT > 10000) winFailShow(true); } else tr.loginT = 0;
    if(v.perm === "denied"){ if(!tr.permT) tr.permT = now; else if(now - tr.permT > 3000) winFailShow(true); } else tr.permT = 0;
  };
  const traceBoot = () => {
    let pv = "none", ses = 0;
    try { pv = String((window.BestlyDock.pv() || {}).preview || "none").slice(0, 8); } catch {}
    try { ses = D.cfg.session && D.cfg.session() ? 1 : 0; } catch {}
    const ua = ((navigator.userAgent || "").match(/(Chrome|Version|Firefox)\/[\d.]+/) || ["?"])[0];
    traceSend("win_boot", BUILD_LABEL + "|st=" + (standalone() ? 1 : 0) + "|op=" + (window.opener ? 1 : 0) + "|bc=" + (BC ? 1 : 0) + "|ses=" + ses + "|hand=" + (D.winO && D.winO.hand ? 1 : 0) + "|pv=" + pv + "|ua=" + ua);
  };

  /* Safari (and every iPhone and iPad browser, which are Safari underneath) shows the camera question only for a tap INSIDE the page that asks, and the call page is
     a frame from another site: a tap on a button of this page never counts for it. So such a window never starts the call in the frame unless the camera and
     microphone are already allowed; it goes to the plain Bestly Cloud call page, which is the site's own page with Talk's own Join button and the real question.
     Chrome and the Dock app ask without a tap, so they keep the quick start. */
  const webkitLike = () => {
    try {
      const ua = navigator.userAgent || "", ios = /iP(hone|ad|od)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      return ios || (/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Android|Firefox\//.test(ua));
    } catch { return false; }
  };
  const gateHdr = () => {      /* the window's own copy of the header while the line is up: the same words the other page shows */
    const g = document.querySelector(".bd-wingate"); if(!g) return;
    const b = g.querySelector(".bd-gh b"), s = g.querySelector(".bd-gh span");
    const t = (D.cfg && D.cfg.title) || "Strategy call", st = D.winOp && D.winOp.live && D.winOp.text ? D.winOp.text : "";
    if(b.textContent !== t) b.textContent = t; if(s.textContent !== st) s.textContent = st; s.hidden = !st;
  };
  const gateLine = (txt) => {      /* the one line: the old words fade out, the new ones fade in (nothing moves) */
    let g = document.querySelector(".bd-wingate");
    if(!g){
      g = document.createElement("div"); g.className = "bd-wingate"; g.setAttribute("role", "status"); g.setAttribute("aria-live", "polite");
      g.innerHTML = '<div class="bd-gh"><b></b><span hidden></span></div><div class="bd-gm"><i class="bd-gd" aria-hidden="true"></i><p class="bd-gt"></p></div>';
      document.body.appendChild(g);
    }
    g.removeAttribute("data-off"); gateHdr();
    const p = g.querySelector(".bd-gt");
    if(p.textContent === txt) return;
    if(!p.textContent){ p.textContent = txt; return; }
    p.dataset.sw = "1"; setTimeout(() => { p.textContent = txt; delete p.dataset.sw; }, 190);
  };
  const gateOff = () => {
    const g = document.querySelector(".bd-wingate"); if(!g || g.dataset.off === "1") return;
    g.dataset.off = "1"; setTimeout(() => { try { g.remove(); } catch {} }, 320);
  };
  const gateWatch = () => {      /* the line stays until the window is past the pre-join card (joined, or showing the call), never longer than 15 s */
    const t0 = Date.now(); clearInterval(D.timers.gate);
    D.timers.gate = setInterval(() => {
      if(D.ncGoing || D.winNc){ return; }
      if(D.winLeft || D.winSaid || (D.root && D.root.dataset.mode !== "prejoin") || Date.now() - t0 > 15000){ clearInterval(D.timers.gate); gateOff(); }
    }, 200);
  };
  const winStartShow = () => {      /* WebKit, the camera not allowed yet: one big button; the tap is the person's own gesture in this window, then the call starts */
    D.winTried = true; D.winHold = true; clearTimeout(D.timers.winwd); clearTimeout(D.timers.winfail);      /* no camera question reaches the call page before the tap */
    gateLine("Tap Start the call to turn on your camera and microphone");
    const g = document.querySelector(".bd-wingate"); if(!g) return;
    const d0 = g.querySelector(".bd-gd"); if(d0) d0.hidden = true;
    let b = g.querySelector(".bd-gb");
    if(!b){
      b = document.createElement("button"); b.type = "button"; b.className = "bd-gb"; b.textContent = "Start the call"; g.querySelector(".bd-gm").appendChild(b);
      b.onclick = () => {
        D.winHold = false; b.remove(); const d1 = g.querySelector(".bd-gd"); if(d1) d1.hidden = false;
        gateLine("Starting your call"); winSend({ t: "win", s: "tapped" }); traceSend("win_start_tap", traceSnap());
        gateWatch(); join(!D.pre.cam);
        clearTimeout(D.timers.winfail); D.timers.winfail = setTimeout(winFailShow, 26000);
      };
    }
    try { window.focus(); b.focus({ preventScroll: true }); } catch {}
    winSend({ t: "win", s: "tap" }); say("Tap Start the call.");
  };
  const winGate = async (o) => {
    const want = o.cam !== false; let q = "none", ok = false;
    gateLine("Starting your call");
    try {
      if(navigator.permissions && navigator.permissions.query){
        const m = await navigator.permissions.query({ name: "microphone" }), c = want ? await navigator.permissions.query({ name: "camera" }) : { state: "granted" };
        q = m.state + "/" + c.state; ok = m.state === "granted" && c.state === "granted";
      }
    } catch (err) { q = "err"; }
    if(!D.winGo || D.st.joined || D.winLeft) return;
    const wk = webkitLike(), auto = ok || !wk;
    traceSend("win_gate", "q=" + q + " pm=" + (D.v5.perm || "") + " wk=" + (wk ? 1 : 0) + " auto=" + (auto ? 1 : 0));
    if(auto){ gateWatch(); join(!D.pre.cam); return; }
    winStartShow();
  };
  const winTapped = () => {      /* a tap on Join in the pre-join card (never shown in this window now, kept for a window opened by hand) */
    if(!D.win) return;
    clearTimeout(D.timers.winfail); D.timers.winfail = setTimeout(winFailShow, 26000);
    traceSend("win_tapped", traceSnap());
    try { askPreview(true); } catch {}
  };
  const winAnnounce = () => {      /* the window tells the other page it is in the call: the frame has joined and is not waiting on its camera question */
    if(!D.win || D.winSaid || !inCall()) return; D.winSaid = true;
    clearTimeout(D.timers.winfail); clearTimeout(D.timers.nc); { const f0 = document.querySelector(".bd-winfail"); if(f0) f0.remove(); }
    winSend({ t: "win", s: "joined", mic: !D.st.muted, cam: !!D.st.camera });
  };
  const goNextcloud = async () => {
    clearTimeout(D.timers.nc); if(D.ncGoing || D.winSaid || D.winLeft) return; D.ncGoing = true;
    let u = "";
    try { const t = await Promise.race([Promise.resolve(D.ncTkP || D.cfg.ticket()), new Promise((_, rj) => setTimeout(() => rj(new Error("slow")), 4000))]); u = plainOf(t && t.url); } catch {}      /* a fresh ticket: the one the frame used is spent */
    if(!u) u = plainUrl();
    if(!u || D.winSaid || D.winLeft){ D.ncGoing = false; return; }
    traceSend("win_tonc", "to=" + hostPath(u));
    winSend({ t: "win", s: "tonc" });
    D.winLeft = true; D.leaving = true; post("leave");      /* this page leaves quietly: closing it must not tell the other page the call ended */
    setTimeout(() => { try { location.assign(u); } catch {} }, D.winNc ? 300 : 900);      /* the trace and the message get out first */
  };
  const winFailShow = (force) => {
    if(!D.cfg || D.winSaid || D.winLeft || !(D.win || D.winO) || document.querySelector(".bd-winfail") || inCall()) return;      /* a window that is in the call never gets the card */
    if(D.signing && !D.ncLate){ D.ncLate = true; clearTimeout(D.timers.winfail); D.timers.winfail = setTimeout(winFailShow, 26000); return; }      /* someone is signing in right now: a little longer, once */
    const v = D.v5 || {};
    traceSend("win_nojoin", traceSnap() + " rs=" + (D.winTried ? 1 : 0) + " op=" + (window.opener ? 1 : 0) + " pv=" + pvTag());
    const c = D.cfg.winFail || {}, el = (tag, cls, txt) => { const x = document.createElement(tag); if(cls) x.className = cls; if(txt) x.textContent = txt; return x; };
    const m = el("div", "bd-winfail"), box = el("div", "bd-wf");
    m.setAttribute("role", "alertdialog"); m.setAttribute("aria-label", c.title || "This window isn't connecting.");
    box.appendChild(el("h2", "", c.title || "This window isn't connecting."));
    box.appendChild(el("p", "", c.body || "Opening your call in Bestly Cloud instead."));
    if(v.perm === "denied" || v.perm === "prompt") box.appendChild(el("p", "", "The camera or microphone may need permission in this window."));
    const row = el("div", "bd-wfb"), b1 = el("button", "bd-wf1", c.back || "Back"), b2 = el("button", "bd-wf2", c.nc || "Open in Bestly Cloud now");
    b1.type = "button"; b2.type = "button";
    b1.onclick = () => {      /* back: this window leaves quietly, the other page still has the call and shows it again */
      clearTimeout(D.timers.nc); D.winLeft = true; D.leaving = true; winSend({ t: "win", s: "nojoin" }); post("leave");
      try { if(D.frame) D.frame.src = "about:blank"; } catch {}
      m.remove(); setTimeout(() => winGone("Your call is still running. You can close this window."), 150);
    };
    b2.onclick = () => goNextcloud();
    row.appendChild(b1); row.appendChild(b2);
    box.appendChild(row); m.appendChild(box); document.body.appendChild(m);
    try { b2.focus(); } catch {}
    say("This window is not connecting. Opening your call in Bestly Cloud instead.");
    clearTimeout(D.timers.nc); D.timers.nc = setTimeout(goNextcloud, 2500);
  };
  /* the call window, the quick start did not get into the call in time: start again the host's own way (it asks for a new ticket itself), once */
  const winRestart = (why) => {
    if(!D.win || D.winSaid || D.winTried || D.winLeft || D.winNc) return; D.winTried = true;
    fault("win_stall", why + " br=" + D.st.bridge + " w=" + D.warm.state + " fj=" + (D.frameJoined ? 1 : 0) + " lg=" + (D.login ? 1 : 0));
    post("leave");
    clearTimeout(D.timers.bridge); clearInterval(D.timers.rejoin); clearTimeout(D.timers.slow); clearInterval(D.timers.clock);
    unwarm();
    if(D.frame){ try { D.frame.src = "about:blank"; } catch {} D.frame.remove(); D.frame = null; }
    D.el.frameBox.querySelectorAll("iframe").forEach(x => x.remove());
    waitText("Getting your camera ready"); waitOn(true); D.v5 = freshV5(D.legacy ? "legacy" : "pending");
    D.login = false; D.signing = false; paintLogin(); D.el.warn.hidden = true; D.frameJoined = false; lastConn = null;
    Object.assign(D.st, { scout: false, joined: false, sharing: null, people: [], bridge: "wait" });
    D.chat.run = false; D.winTk = null;
    setTimeout(() => { D.winGo = false; window.BestlyDock.openWin(D.winO || {}); }, 400);
  };
  /* this page IS the call window (opened with Pop out, or by hand) */
  const winEnter = () => {
    D.win = true; document.documentElement.classList.add("bd-win");
    { let rf = 0; const fit = () => { if(rf) return; rf = requestAnimationFrame(() => { rf = 0; try { syncVV(); fitFrame(); } catch {} }); };      /* a window dragged to a new size: the layout is measured again on the next frame, whatever event the browser sent */
      addEventListener("resize", fit); addEventListener("orientationchange", fit); try { if(window.ResizeObserver) new ResizeObserver(fit).observe(document.documentElement); } catch {} }

    try { document.title = "Strategy call"; } catch {}
    document.addEventListener("visibilitychange", () => { try { traceSend("win_vis", document.visibilityState + " " + traceSnap()); winAnnounce(); } catch {} });
    clearInterval(D.timers.beat); D.timers.beat = setInterval(() => { if(D.winSaid && D.st.joined) winSend({ t: "win", s: "beat" }); }, 4000);
    addEventListener("pagehide", () => { if(D.win && D.st.joined && !D.winLeft){ D.winLeft = true; D.leaving = true; post("leave"); winSend({ t: "win", s: "left", mic: !D.st.muted, cam: !!D.st.camera }); } });      /* closing the window leaves the call */
  };
  const winGone = (txt) => {
    try { window.close(); } catch {}
    setTimeout(() => {
      if(document.querySelector(".bd-wingone")) return;
      const m = document.createElement("div"); m.className = "bd-wingone"; m.setAttribute("role", "status");
      m.textContent = typeof txt === "string" ? txt : "You left the call. You can close this window."; document.body.appendChild(m);
    }, 400);
  };
  const onWin = (m, via) => {
    if(!m || (m.t !== "win" && m.t !== "cmd") || m.k !== String((D.cfg && D.cfg.winKind) || "page")) return;
    if(m.i){ const sn = D.seen || (D.seen = new Set()); if(sn.has(m.i)) return; sn.add(m.i); if(sn.size > 200) sn.clear(); }      /* the same message can come by both ways */
    if(!D.win && D.pop.on && !D.pop.logged && m.t === "win"){ D.pop.logged = true; D.pop.via = via || "?"; fault("pop_msg", "via=" + D.pop.via + "|s=" + m.s + "|" + Math.round((Date.now() - D.pop.t) / 1000) + "s|n=" + Math.random().toString(36).slice(2, 6)); }      /* the first word from the window, and which way it came */
    const p = D.pop;
    if(m.t === "cmd" && m.c === "ticket"){ if(!D.win && !D.winGo && D.winO && m.tk && m.tk.url){ D.winTk = m.tk; window.BestlyDock.openWin(D.winO); } return; }      /* the new window: the ticket came, the call starts now */
    if(m.t === "win" && m.s === "state"){ D.winOp = { live: !!m.live, text: String(m.text || "").slice(0, 120) }; if(D.win && D.st.open && !D.st.joined){ try { paintPre(); } catch {} } try { gateHdr(); } catch {} return; }      /* the page that opened this window says who is in the call (it can arrive before the window knows it is one) */
    if(D.win){      /* this is the call window */
      if(m.t === "cmd" && m.c === "leave"){ if(D.st.joined){ D.leaving = true; leave(false, false, true); } else if(!D.winLeft){ D.winLeft = true; D.leaving = true; winSend({ t: "win", s: "left", mic: !D.st.muted, cam: !!D.st.camera }); } }      /* it leaves, and tells the other page only when the call page has left */
      else if(m.t === "cmd" && m.c === "focus"){ try { window.focus(); } catch {} }
      else if(m.t === "win" && m.s === "who" && D.winSaid && D.st.joined) winSend({ t: "win", s: "joined", mic: !D.st.muted, cam: !!D.st.camera });
      return;
    }
    if(m.t !== "win") return;
    if((m.s === "need" || m.s === "who") && (D.st.joined || p.on) && Date.now() - (D.stSentAt || 0) > 1500){      /* the window being opened asks: say who is in the call, so its header matches this one (this page has left by then, so it remembers the words) */
      D.stSentAt = Date.now();
      try { const tx = D.st.joined ? (D.stText = stateText()) : (D.stText || ""); winSend({ t: "win", s: "state", live: true, text: tx }); } catch {}
    }
    if(m.s === "need"){ popTicketSend(); return; }      /* the window we opened asks for its ticket */
    if(m.s === "joined"){
      p.beat = Date.now();
      if(p.on && !p.joined && !p.rj){ p.joined = true; p.tap = false; p.mic = m.mic !== false; p.cam = m.cam !== false; fault("pop_joined", Math.round((Date.now() - (p.nav || p.t)) / 100) / 10 + "s|n=" + Math.random().toString(36).slice(2, 6)); applyChrome(); popPaint(); say("Your call is now in its own window."); }      /* this page left before the window loaded: nothing else to do */
      else if(!p.on && !D.st.joined && D.cfg){      /* a window opened before this page was loaded: this page shows the card for it */
        Object.assign(p, { on: true, w: null, t: Date.now(), beat: Date.now(), joined: true, back: false, mic: m.mic !== false, cam: m.cam !== false });
        D.st.open = true; D.root.hidden = false; applyChrome(); place(false); popWatch();
        try { D.cfg.onChange && D.cfg.onChange(true); } catch {}
      }
    } else if(m.s === "beat"){ if(p.on) p.beat = Date.now(); }
    else if(m.s === "left"){ if(p.on){ p.mic = m.mic !== false; p.cam = m.cam !== false; if(p.rjw){ p.rjw(); } else if(!p.joined){ p.rj = true; note("The new window left before it was in the call. Your call is back here."); popReturn(); } else if(p.back) popReturn(); else popEnd(); } }
    else if(m.s === "tap"){ if(p.on && !p.joined){ p.tap = true; popPaint(); } }      /* the new window waits for a tap on Start the call */
    else if(m.s === "tapped"){ if(p.on){ p.tap = false; popPaint(); } }
    else if(m.s === "ncgate"){ if(p.on && !p.joined){ p.ncg = true; popPaint(); } }      /* the new window is about to open the plain Bestly Cloud page */
    else if(m.s === "tonc"){ if(p.on){ p.nc = true; p.beat = Date.now(); if(!p.joined){ p.joined = true; p.tap = false; applyChrome(); } popPaint(); } }      /* the window hands itself to the plain Bestly Cloud page: this page leaves, so the same person is not in the call twice */
    else if(m.s === "nojoin"){ if(p.on && !p.joined) popFail("nojoin"); }      /* the window says it is not connecting: the call stays here and says so */
  };

  /* ── public ──────────────────────────────────────────────────────── */
  window.BestlyDock = {
    init(cfg){
      if(D.cfg) return; D.cfg = cfg; try { window.BestlyDock.pv(); } catch {} load(); loadSz();
      try { if(!localStorage.getItem(KEY) && cfg.defaultSpot) D.pos.spot = cfg.defaultSpot; } catch { if(cfg.defaultSpot) D.pos.spot = cfg.defaultSpot; }
      build();
      addEventListener("message", onMsg); armNav();
      addEventListener("message", (ev) => { try { if(ev.origin === location.origin && ev.data && ev.data.bestlyWin) onWin(ev.data.bestlyWin, "op"); } catch {} });
      if(BC){ BC.onmessage = (ev) => { try { onWin(ev.data, "bc"); } catch {} }; winSend({ t: "win", s: "who" }); }
      D.mq = (() => { try { return matchMedia("(max-width: 640px)"); } catch { return null; } })();
      if(D.mq && D.mq.addEventListener) D.mq.addEventListener("change", () => { D.full = false; applyChrome(); });
      this.ready = true;
    },
    open(){
      if(!D.cfg) return;
      if(D.st.joined || D.pop.on){ this.show(); return; }
      D.st.open = true; D.root.hidden = false; D.bar = false; D.pre.mic = true; D.pre.cam = true;
      if(D.warm.state === "failed") D.warm.state = "idle";      /* a new try starts the v5 way again */
      D.v5 = freshV5(D.legacy ? "legacy" : "pending");
      D.el.pre.hidden = false; D.el.call.hidden = !(v5on() || D.warm.state === "loading"); D.el.err.hidden = true;
      D.el.title.textContent = (D.cfg.title || "Strategy call");
      setMode("prejoin"); paintPre(); applyChrome(); place(false); startPre();
      /* the card is already painted by the time the ticket comes back and the call page starts to load (that is a network wait, so nothing heavy runs on the tap) */
      warm(); askPreview();
      setTimeout(() => { try { D.el.join.focus({ preventScroll: true }); } catch {} }, 80);
    },
    show(){ if(!D.cfg) return; if(D.pop.on && D.pop.joined){ D.root.hidden = false; D.st.open = true; applyChrome(); place(true); popFocus(); return; } if(!D.st.joined) return; D.root.hidden = false; D.bar = false; D.full = phone(); applyChrome(); place(true); },
    leave(){ if(D.pop.on && !D.st.joined){ winSend({ t: "cmd", c: "leave" }); popEnd(); return; } leave(); },
    /* the call window (/callwin): opens the call full window and joins at once with the microphone and camera the other page had */
    openWin(o){ if(!D.cfg || D.winGo) return; this.winWatch(); D.winGo = true; clearInterval(D.timers.need); o = o || {}; if(!D.win) winEnter(); if(!D.winTried){ clearTimeout(D.timers.winwd); D.timers.winwd = setTimeout(() => winRestart("12 s"), 12000); } this.open(); D.pre.mic = o.mic !== false; D.pre.cam = o.cam !== false; winGate(o); },
    /* the call window, the quick way: ask the page that opened it for the ticket and start the call the moment it arrives, without waiting for the app around it.
       The host's own (slower) start is still there as the way when nobody answers. */
    /* a window that is not in the call 30 s after it loaded says so (and the page that opened it hears it) */
    winWatch(o){
      if(!D.cfg) return; if(o && !D.winO) D.winO = o;
      if(D.timers.winfail) return;
      D.timers.winfail = setTimeout(winFailShow, 26000);
      try { if(!document.querySelector(".bd-buildtag")){ const b = document.createElement("div"); b.className = "bd-buildtag"; b.textContent = "r11"; b.title = BUILD_LABEL; document.body.appendChild(b); } } catch {}
      traceBoot(); D.timers.trace = setInterval(traceTick, 500);
    },
    /* the preview id (and flags) this page was opened with: the address can lose them, so they are kept for the window Pop out opens */
    pv(){
      const q = new URLSearchParams(location.search), o = {}; ["preview", "callui", "prewarm"].forEach(n => { if(q.get(n)) o[n] = q.get(n); });
      try { if(o.preview){ sessionStorage.setItem("bestly.pv", JSON.stringify(o)); return o; }
        const st = JSON.parse(sessionStorage.getItem("bestly.pv") || "{}"), m = /PREVIEW · ([0-9a-f]{8})/.exec(document.body.textContent || "");
        if(m && st.preview && st.preview.indexOf(m[1]) === 0) return st; } catch {}
      return o;
    },
    winFast(o){
      this.winWatch(o);
      if(!D.cfg || D.win || D.winGo || !BC) return; D.winO = o || {};
      const ask = () => { if(D.winGo){ clearInterval(D.timers.need); return; } winSend({ t: "win", s: "need" }); };
      clearInterval(D.timers.need); D.timers.need = setInterval(ask, 300); ask();
      setTimeout(() => clearInterval(D.timers.need), 20000);
    },
    sync(o){ if(D.pop.on) return; if(o && o.live === false && D.st.open && !D.st.joined){ paintPre(); } if(D.st.open && !D.st.joined) paintPre(); },
    state(){ return JSON.parse(JSON.stringify({ st: D.st, pos: D.pos, cur: D.cur || null, sz: { cw: D.sz.cw, eff: D.sz.eff, max: D.sz.max, strip: D.sz.strip, side: D.side }, warm: { state: D.warm.state, alive: D.warm.alive, loaded: D.warm.loaded }, connecting: connecting() })); },
    isScout, minShort, minLong, _spots: SPOTS, _T: T, _linkify: linkify,
    /* round 5: for the page around the window */
    live: callLive,
    rect: dockRect,
    onGeom(fn){ if(typeof fn === "function") geomSubs.push(fn); geomPing(); },
    /* how far a thing standing on the bottom edge, spanning x0..x1 and reaching up to yTop, must rise to clear the window (0 when it is already clear). The whole-screen window is cleared by the page putting the thing at the top. */
    lift(x0, x1, yTop){ const g = dockRect(); if(!g || g.full || g.right <= x0 || g.left >= x1 || g.bottom <= yTop) return 0; return Math.max(0, Math.ceil(innerHeight - g.top + 12)); },
  };
})();
