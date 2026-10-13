// Bestly Montage: one vertical short for any product (art direction: quiet cards, the brand's own card kit).
// Generalized from HokuShort: palettes, fonts, wordmark/logo and the closing-card art arrive in the `brand` prop,
// so InventoryProof, Cookie Yeti and Bestly Cloud each look like their own Instagram cards. Lives outside the
// OpenMontage tree (/opt/bestly/montage) and is copied in at render time.
// 2026-10-12 (re-cut fix): free motion graphics. A scene may carry an `icon` (one of ICONS below, drawn as SVG in the
// brand palette, drawn on by a soft spring inside a feathered glow), the closing card may carry `chips` (icon + 2-4
// words) and a hero logo, and a brand may switch on slow ambient glows. Every glow is a radial gradient that fades to
// transparent (no hard edges). Unknown icon names draw nothing, so older props still render exactly as before.
import React, {useEffect, useState} from 'react';
import {
  AbsoluteFill, Audio, CalculateMetadataFunction, Img, OffthreadVideo, Sequence, continueRender, delayRender,
  interpolate, spring, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';

export type Scene = {kicker?: string; line: string; sub?: string; start: number; end: number; clip?: string; icon?: string};
export type Chip = {icon: string; text: string};
export type EndCard = {title: string; sub?: string; cta: string; start: number; end: number; chips?: Chip[]};
export type Theme = {bg: string; veil: string; ink: string; dim: string; accent: string; head?: string};
export type Brand = {
  fonts: {family: string; file: string; weight: string}[];
  head: {family: string; weight: number; sizes: [number, number, number]; spacing: string};   // sizes: short, mid, long lines
  label: {family: string; weight: number};                       // kicker, sub line, handle, call to action
  themes: Record<string, Theme>;
  logo: {
    image?: string; height?: number; blend?: string;               // a real logo file in public/
    wordmark?: {parts: {text: string; color?: string; size?: number; dy?: number}[]; family: string; weight: number; size: number; tagline?: string};
  };
  end: {image?: string; imageHeight?: number; imageRadius?: number; handle?: string; heroLogo?: boolean};
  ambient?: boolean;                                              // slow feathered glows behind everything
};
export type BrandProps = {
  brand: Brand;
  theme: string;
  scenes: Scene[];
  end: EndCard | null;
  audio: {narration?: string; music?: string; musicVolume?: number};
};

export const brandMeta: CalculateMetadataFunction<BrandProps> = async ({props}) => {
  const last = Math.max(props.end ? props.end.end : 0, ...props.scenes.map((s) => s.end), 1);
  return {durationInFrames: Math.ceil(last * 30)};
};

const useFonts = (brand: Brand) => {
  const [handle] = useState(() => delayRender('brand fonts'));
  useEffect(() => {
    const faces = brand.fonts.map((f) => new FontFace(f.family, `url(${staticFile(f.file)})`, {weight: f.weight}));
    Promise.all(faces.map((f) => f.load().then((ff) => (document as any).fonts.add(ff))))
      .then(() => continueRender(handle))
      .catch(() => continueRender(handle));
  }, [handle]);
};

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const rgba = (hex: string, a: number) => {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const v = parseInt(n.slice(0, 6), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
};

// ---------------------------------------------------------------------------------------------------------------
// Icons: a small fixed set that fits the products. 100x100 viewBox, round strokes. s = stroke, f = soft filled body,
// h = highlight stroke (ink color), d = dot (cx, cy, r; hot = ink color).
// ---------------------------------------------------------------------------------------------------------------
type Seg = {k: 's' | 'f' | 'h' | 'd'; d?: string; c?: [number, number, number]; hot?: boolean};
const S = (d: string): Seg => ({k: 's', d});
const F = (d: string): Seg => ({k: 'f', d});
const H = (d: string): Seg => ({k: 'h', d});
const D = (x: number, y: number, r: number, hot = false): Seg => ({k: 'd', c: [x, y, r], hot});
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`;

const FOLDER = 'M12 28 a6 6 0 0 1 6-6 H38 L46 31 H82 a6 6 0 0 1 6 6 V72 a6 6 0 0 1-6 6 H18 a6 6 0 0 1-6-6 Z';
const LOCK = 'M32 44 H68 a8 8 0 0 1 8 8 V74 a8 8 0 0 1-8 8 H32 a8 8 0 0 1-8-8 V52 a8 8 0 0 1 8-8 Z';
const BOX = 'M28 22 H72 a10 10 0 0 1 10 10 V38 a10 10 0 0 1-10 10 H28 a10 10 0 0 1-10-10 V32 a10 10 0 0 1 10-10 Z';
const BOX2 = 'M28 52 H72 a10 10 0 0 1 10 10 V68 a10 10 0 0 1-10 10 H28 a10 10 0 0 1-10-10 V62 a10 10 0 0 1 10-10 Z';
const CAL = 'M24 24 H76 a8 8 0 0 1 8 8 V74 a8 8 0 0 1-8 8 H24 a8 8 0 0 1-8-8 V32 a8 8 0 0 1 8-8 Z';
const BUBBLE = 'M18 26 a8 8 0 0 1 8-8 H74 a8 8 0 0 1 8 8 V56 a8 8 0 0 1-8 8 H46 L30 79 V64 H26 a8 8 0 0 1-8-8 Z';
const TAG = 'M48 14 H80 a6 6 0 0 1 6 6 V52 L52 86 a6 6 0 0 1-8.5 0 L14 56.5 a6 6 0 0 1 0-8.5 Z';
const EYE = 'M8 50 C24 28 76 28 92 50 C76 72 24 72 8 50 Z';

export const ICONS: Record<string, Seg[]> = {
  files: [F(FOLDER), S(FOLDER), H('M28 52 H72'), H('M28 64 H56')],
  lock: [F(LOCK), S(LOCK), S('M34 44 V34 a16 16 0 0 1 32 0 V44'), D(50, 60, 5, true), H('M50 65 V72')],
  box: [F(BOX), S(BOX), F(BOX2), S(BOX2), D(31, 35, 3.6, true), H('M43 35 H70'), D(31, 65, 3.6, true), H('M43 65 H70')],
  people: [F(circle(50, 34, 10)), S(circle(50, 34, 10)), S('M30 76 a20 20 0 0 1 40 0'), S(circle(24, 44, 7)), S('M10 72 a14 14 0 0 1 16-14'),
           S(circle(76, 44, 7)), S('M90 72 a14 14 0 0 0 -16-14')],
  calendar: [F(CAL), S(CAL), H('M16 42 H84'), S('M34 16 V30 M66 16 V30'), D(34, 57, 2.8), D(50, 57, 2.8), D(66, 57, 2.8), D(34, 70, 2.8), D(50, 70, 3.4, true)],
  chat: [F(BUBBLE), S(BUBBLE), H('M32 35 H68'), H('M32 47 H56')],
  key: [F(circle(30, 50, 17)), S(circle(30, 50, 17)), D(30, 50, 5, true), S('M47 50 H90'), H('M76 50 V64'), H('M87 50 V60')],
  check: [F(circle(50, 50, 34)), S(circle(50, 50, 34)), H('M34 51 L46 63 L68 38')],
  tag: [F(TAG), S(TAG), H(circle(72, 28, 5)), H('M20 22 L80 82')],
  eyeslash: [F(EYE), S(EYE), S(circle(50, 50, 10)), H('M20 82 L80 18')],
};
export const ICON_NAMES = Object.keys(ICONS);

const Icon: React.FC<{name?: string; t: Theme; draw: number; size: number}> = ({name, t, draw, size}) => {
  const segs = name ? ICONS[name] : undefined;
  if (!segs) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" strokeLinecap="round" strokeLinejoin="round"
         style={{overflow: 'visible', filter: `drop-shadow(0 0 ${size * 0.07}px ${rgba(t.accent, 0.5)})`}}>
      {segs.map((sg, i) => {
        const q = Math.max(0, Math.min(1, draw * 1.35 - i * 0.07));
        if (sg.k === 'f') return <path key={i} d={sg.d} fill={rgba(t.accent, 0.16 * Math.max(0, Math.min(1, draw * 1.6 - 0.35)))} stroke="none" />;
        if (sg.k === 'd') {
          const [cx, cy, r] = sg.c as [number, number, number];
          return <circle key={i} cx={cx} cy={cy} r={r * q} fill={sg.hot ? t.ink : t.accent} />;
        }
        return <path key={i} d={sg.d} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - q}
                     stroke={sg.k === 'h' ? t.ink : t.accent} strokeWidth={sg.k === 'h' ? 3.4 : 4.2} opacity={Math.min(1, q * 3)} />;
      })}
    </svg>
  );
};

// A glowing disc with a slow arc orbiting it and the icon drawing itself on inside. Everything fades to transparent.
const Emblem: React.FC<{name: string; t: Theme; size: number; delay?: number; dur: number}> = ({name, t, size, delay = 0, dur}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame: f - delay, fps, config: {damping: 15, stiffness: 80, mass: 0.9}});
  const draw = spring({frame: f - delay - 5, fps, config: {damping: 200, stiffness: 38}});
  const out = interpolate(f, [dur - 10, dur], [1, 0], clamp);
  const breathe = 1 + 0.035 * Math.sin(f / 21);
  const rot = (f * 1.5) % 360;
  const fade = Math.min(1, enter) * out;
  const dots = [0, 1, 2].map((k) => {
    const a = ((f * (0.9 + 0.35 * k) + k * 120) * Math.PI) / 180;
    const r = size * (0.5 + 0.035 * k);
    return {x: Math.cos(a) * r, y: Math.sin(a) * r * 0.96, s: 26 - k * 5};
  });
  return (
    <div style={{position: 'relative', width: size, height: size, opacity: fade, transform: `scale(${(0.55 + 0.45 * enter) * breathe})`}}>
      <div style={{position: 'absolute', inset: -size * 0.42, background: `radial-gradient(circle, ${rgba(t.accent, 0.34)} 0%, ${rgba(t.accent, 0.13)} 34%, ${rgba(t.accent, 0)} 66%)`}} />
      <div style={{position: 'absolute', inset: size * 0.06, borderRadius: '50%',
                   background: `radial-gradient(circle at 50% 40%, ${rgba(t.accent, 0.26)} 0%, ${rgba(t.accent, 0.09)} 62%, ${rgba(t.accent, 0)} 100%)`}} />
      <div style={{position: 'absolute', inset: 0,
                   WebkitMaskImage: `conic-gradient(from ${rot}deg, transparent 0deg, #000 130deg, transparent 260deg)`,
                   maskImage: `conic-gradient(from ${rot}deg, transparent 0deg, #000 130deg, transparent 260deg)`}}>
        <svg width={size} height={size} viewBox="0 0 100 100"><circle cx="50" cy="50" r="47" fill="none" stroke={t.accent} strokeWidth="1.1" opacity="0.8" /></svg>
      </div>
      {dots.map((d, i) => (
        <div key={i} style={{position: 'absolute', left: size / 2 + d.x - d.s, top: size / 2 + d.y - d.s, width: d.s * 2, height: d.s * 2,
                             background: `radial-gradient(circle, ${rgba(t.accent, 0.85)} 0%, ${rgba(t.accent, 0.25)} 40%, ${rgba(t.accent, 0)} 70%)`}} />
      ))}
      <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <Icon name={name} t={t} draw={draw} size={size * 0.62} />
      </div>
    </div>
  );
};

// Big slow glows drifting behind everything (brand.ambient).
const Ambient: React.FC<{t: Theme}> = ({t}) => {
  const f = useCurrentFrame();
  const orbs = [{x: 14, y: 20, s: 980, p: 0}, {x: 88, y: 50, s: 1080, p: 2.1}, {x: 28, y: 84, s: 900, p: 4.2}];
  return (
    <AbsoluteFill>
      {orbs.map((o, i) => (
        <div key={i} style={{position: 'absolute', left: `${o.x + 4 * Math.sin(f / 95 + o.p)}%`, top: `${o.y + 3 * Math.cos(f / 120 + o.p)}%`,
                             width: o.s, height: o.s, marginLeft: -o.s / 2, marginTop: -o.s / 2,
                             background: `radial-gradient(circle, ${rgba(t.accent, 0.15)} 0%, ${rgba(t.accent, 0.05)} 42%, ${rgba(t.accent, 0)} 70%)`}} />
      ))}
    </AbsoluteFill>
  );
};

// Fade + rise in on a soft spring, fade out over the last 10 frames of the scene.
const Rise: React.FC<{delay: number; dur: number; style?: React.CSSProperties; children: React.ReactNode}> = ({delay, dur, style, children}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame: f - delay, fps, config: {damping: 200, stiffness: 90, mass: 1}});
  const out = interpolate(f, [dur - 10, dur], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <div style={{...style, opacity: s * out, transform: `translateY(${(1 - s) * 36}px)`}}>{children}</div>;
};

const lineSize = (b: Brand, text: string) => (text.length > 44 ? b.head.sizes[2] : text.length > 28 ? b.head.sizes[1] : b.head.sizes[0]);

const SceneView: React.FC<{s: Scene; b: Brand; t: Theme; dur: number}> = ({s, b, t, dur}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const drift = interpolate(f, [0, dur], [0, -16]);                  // slow upward drift keeps a still card alive
  const rule = spring({frame: f - 6, fps, config: {damping: 200, stiffness: 60}});
  const size = lineSize(b, s.line);
  const hasIcon = !!(s.icon && ICONS[s.icon]);
  // b-roll: dissolves in and out through the card color, under a veil of it so the line always reads
  const clipIn = interpolate(f, [0, 8, dur - 8, dur], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const zoom = interpolate(f, [0, dur], [1.0, 1.06]);
  return (
    <AbsoluteFill>
      {s.clip ? (
        <AbsoluteFill style={{opacity: clipIn}}>
          <OffthreadVideo src={staticFile(s.clip)} muted
                          style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})`}} />
          <AbsoluteFill style={{background: `linear-gradient(180deg, ${t.veil}8C 0%, ${t.veil}D9 42%, ${t.veil}D9 62%, ${t.veil}99 100%)`}} />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill style={{padding: '0 96px', justifyContent: 'center'}}>
        <div style={{transform: `translateY(${drift}px)`, marginTop: hasIcon ? -30 : -100}}>
          {hasIcon ? (
            <div style={{display: 'flex', justifyContent: 'center', marginBottom: 44}}>
              <Emblem name={s.icon as string} t={t} size={s.kicker ? 400 : 440} dur={dur} />
            </div>
          ) : null}
          {s.kicker ? (
            <Rise delay={0} dur={dur}>
              <div style={{fontFamily: b.label.family, fontWeight: b.label.weight, fontSize: 34, letterSpacing: '0.16em', textTransform: 'uppercase', color: t.accent}}>
                {s.kicker}
              </div>
              <div style={{height: 3, width: 150 * rule, background: `linear-gradient(90deg, ${t.accent}, ${rgba(t.accent, 0)})`, opacity: 0.8, margin: '30px 0 46px'}} />
            </Rise>
          ) : null}
          <Rise delay={5} dur={dur}>
            <div style={{fontFamily: b.head.family, fontWeight: b.head.weight, fontSize: size, lineHeight: 1.1, letterSpacing: b.head.spacing,
                         color: t.head || t.ink, maxWidth: 888, overflowWrap: 'break-word', textWrap: 'balance' as any}}>
              {s.line}
            </div>
          </Rise>
          {s.sub ? (
            <Rise delay={12} dur={dur}>
              <div style={{fontFamily: b.label.family, fontSize: 44, lineHeight: 1.36, color: t.dim, marginTop: 46, maxWidth: 860}}>{s.sub}</div>
            </Rise>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// Plain closing card (every brand without chips): product name, one line, mascot/icon, handle, call to action.
const EndPlain: React.FC<{e: EndCard; b: Brand; t: Theme; dur: number}> = ({e, b, t, dur}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const up = spring({frame: f - 4, fps, config: {damping: 200, stiffness: 55}});
  const hold = dur + 30;                                               // no fade-out on the last card
  const img = b.end.image;
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', padding: '120px 90px 0'}}>
      {img ? (
        <Img src={staticFile(img)}
             style={{height: b.end.imageHeight ?? 440, borderRadius: b.end.imageRadius ?? 0, opacity: up, transform: `translateY(${(1 - up) * 260}px)`, marginBottom: 70}} />
      ) : null}
      <Rise delay={8} dur={hold} style={{textAlign: 'center'}}>
        <div style={{fontFamily: b.head.family, fontWeight: b.head.weight, fontSize: 112, lineHeight: 1.1, letterSpacing: b.head.spacing, color: t.head || t.ink, textWrap: 'balance' as any}}>{e.title}</div>
      </Rise>
      {e.sub ? (
        <Rise delay={14} dur={hold} style={{textAlign: 'center', marginTop: 34}}>
          <div style={{fontFamily: b.label.family, fontSize: 48, lineHeight: 1.3, color: t.dim, maxWidth: 840}}>{e.sub}</div>
        </Rise>
      ) : null}
      {b.end.handle ? (
        <Rise delay={22} dur={hold} style={{textAlign: 'center', marginTop: 56}}>
          <div style={{fontFamily: b.label.family, fontWeight: b.label.weight, fontSize: 44, color: t.accent}}>{b.end.handle}</div>
        </Rise>
      ) : null}
      <Rise delay={28} dur={hold} style={{textAlign: 'center', marginTop: b.end.handle ? 22 : 64}}>
        <div style={{fontFamily: b.label.family, fontWeight: b.label.weight, fontSize: 44, letterSpacing: '0.02em', color: t.ink}}>{e.cta}</div>
      </Rise>
    </AbsoluteFill>
  );
};

const ChipRow: React.FC<{c: Chip; t: Theme; b: Brand; delay: number}> = ({c, t, b, delay}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame: f - delay, fps, config: {damping: 16, stiffness: 85, mass: 0.9}});
  const draw = spring({frame: f - delay - 4, fps, config: {damping: 200, stiffness: 45}});
  const o = Math.min(1, s);
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 34, width: 940, height: 138, padding: '0 40px 0 30px', borderRadius: 69,
                 background: `linear-gradient(90deg, ${rgba(t.accent, 0.2)} 0%, ${rgba(t.accent, 0.08)} 55%, ${rgba(t.accent, 0.02)} 100%)`,
                 boxShadow: `0 0 70px ${rgba(t.accent, 0.14)}`,
                 opacity: o, transform: `translateX(${(1 - s) * -90}px) scale(${0.94 + 0.06 * Math.min(1, s)})`}}>
      <div style={{position: 'relative', width: 96, height: 96, flex: '0 0 96px'}}>
        <div style={{position: 'absolute', inset: -22, background: `radial-gradient(circle, ${rgba(t.accent, 0.4)} 0%, ${rgba(t.accent, 0)} 68%)`}} />
        <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <Icon name={c.icon} t={t} draw={draw} size={88} />
        </div>
      </div>
      <div style={{fontFamily: b.label.family, fontWeight: b.label.weight, fontSize: 52, lineHeight: 1.1, color: t.ink, whiteSpace: 'nowrap'}}>{c.text}</div>
    </div>
  );
};

// Rich closing card: hero logo, product name, one plain line, benefit chips with icons, glowing call to action.
const EndRich: React.FC<{e: EndCard; b: Brand; t: Theme; dur: number}> = ({e, b, t, dur}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const hold = dur + 30;
  const logo = spring({frame: f - 2, fps, config: {damping: 15, stiffness: 70, mass: 1}});
  const cta = spring({frame: f - 64, fps, config: {damping: 14, stiffness: 90, mass: 0.9}});
  const pulse = 0.5 + 0.5 * Math.sin(f / 14);
  const chips = (e.chips || []).filter((c) => c && c.text);
  const sparks = [[170, 430, 34], [905, 360, 26], [110, 1130, 22], [965, 980, 30], [210, 1610, 28], [880, 1590, 24], [560, 270, 20]];
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', padding: '0 90px'}}>
      <div style={{position: 'absolute', left: 540 - 760, top: 780 - 760, width: 1520, height: 1520,
                   background: `radial-gradient(circle, ${rgba(t.accent, 0.2 + 0.04 * pulse)} 0%, ${rgba(t.accent, 0.07)} 38%, ${rgba(t.accent, 0)} 68%)`,
                   opacity: Math.min(1, logo)}} />
      {sparks.map(([x, y, r], i) => (
        <div key={i} style={{position: 'absolute', left: x - r + 10 * Math.sin(f / (40 + i * 7) + i), top: y - r - ((f * (0.25 + 0.05 * i)) % 60),
                             width: r * 2, height: r * 2, opacity: Math.min(1, logo) * (0.35 + 0.45 * Math.sin(f / (18 + i * 3) + i * 2) ** 2),
                             background: `radial-gradient(circle, ${rgba(t.accent, 0.85)} 0%, ${rgba(t.accent, 0.22)} 42%, ${rgba(t.accent, 0)} 72%)`}} />
      ))}
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 90}}>
        {b.end.heroLogo && b.logo.image ? (
          <Img src={staticFile(b.logo.image)} style={{height: 150, mixBlendMode: (b.logo.blend as any) || 'normal', opacity: Math.min(1, logo),
                                                      transform: `scale(${0.7 + 0.3 * logo})`, marginBottom: 34}} />
        ) : null}
        <Rise delay={8} dur={hold} style={{textAlign: 'center'}}>
          <div style={{fontFamily: b.head.family, fontWeight: b.head.weight, fontSize: 128, lineHeight: 1.05, letterSpacing: b.head.spacing, color: t.head || t.ink, textWrap: 'balance' as any}}>{e.title}</div>
        </Rise>
        {e.sub ? (
          <Rise delay={16} dur={hold} style={{textAlign: 'center', marginTop: 30}}>
            <div style={{fontFamily: b.label.family, fontSize: 50, lineHeight: 1.28, color: t.dim, maxWidth: 860}}>{e.sub}</div>
          </Rise>
        ) : null}
        <div style={{display: 'flex', flexDirection: 'column', gap: 26, marginTop: 64, alignItems: 'center'}}>
          {chips.slice(0, 3).map((c, i) => <ChipRow key={i} c={c} t={t} b={b} delay={28 + i * 11} />)}
        </div>
        <div style={{marginTop: 70, opacity: Math.min(1, cta), transform: `translateY(${(1 - Math.min(1, cta)) * 40}px) scale(${0.9 + 0.1 * Math.min(1, cta)})`}}>
          <div style={{fontFamily: b.label.family, fontWeight: b.label.weight, fontSize: 60, letterSpacing: '0.01em', color: t.veil,
                       padding: '28px 84px', borderRadius: 999, background: `linear-gradient(135deg, ${t.accent} 0%, ${rgba(t.accent, 0.82)} 100%)`,
                       boxShadow: `0 0 ${70 + 40 * pulse}px ${rgba(t.accent, 0.38 + 0.12 * pulse)}`}}>{e.cta}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const EndView: React.FC<{e: EndCard; b: Brand; t: Theme; dur: number}> = (p) =>
  (p.e.chips && p.e.chips.length) || p.b.end.heroLogo ? <EndRich {...p} /> : <EndPlain {...p} />;

const Logo: React.FC<{b: Brand; opacity?: number}> = ({b, opacity = 1}) => {
  const l = b.logo;
  if (l.image) {
    return <Img src={staticFile(l.image)} style={{position: 'absolute', left: 96, top: 120, height: l.height ?? 76, mixBlendMode: (l.blend as any) || 'normal', opacity}} />;
  }
  if (l.wordmark) {
    const w = l.wordmark;
    return (
      <div style={{position: 'absolute', left: 96, top: 128, opacity}}>
        <div style={{display: 'flex', fontFamily: w.family, fontWeight: w.weight, fontSize: w.size, letterSpacing: '-0.01em', color: '#FFFFFF', lineHeight: 1}}>
          {w.parts.map((p, i) => (
            <div key={i} style={{color: p.color, fontSize: p.size ?? w.size, marginTop: p.dy ?? 0, whiteSpace: 'pre'}}>{p.text}</div>
          ))}
        </div>
        {w.tagline ? (
          <div style={{fontFamily: w.family, fontWeight: 500, fontSize: Math.round(w.size * 0.44), letterSpacing: '0.22em', color: b.themes[Object.keys(b.themes)[0]].dim, marginTop: 10, opacity: 0.85}}>{w.tagline}</div>
        ) : null}
      </div>
    );
  }
  return null;
};

export const BrandShort: React.FC<BrandProps> = (p) => {
  const b = p.brand;
  useFonts(b);
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const name = b.themes[p.theme] ? p.theme : Object.keys(b.themes)[0];
  const t = b.themes[name];
  const fr = (sec: number) => Math.round(sec * fps);
  const rich = !!(p.end && ((p.end.chips && p.end.chips.length) || b.end.heroLogo));
  // the small corner logo steps aside when the closing card shows its own big one
  const logoOp = rich && b.end.heroLogo && p.end ? interpolate(f, [fr(p.end.start), fr(p.end.start) + 9], [1, 0], clamp) : 1;
  return (
    <AbsoluteFill style={{background: t.bg}}>
      {b.ambient ? <Ambient t={t} /> : null}
      {p.scenes.map((s, i) => (
        <Sequence key={i} from={fr(s.start)} durationInFrames={fr(s.end - s.start)}>
          <SceneView s={s} b={b} t={t} dur={fr(s.end - s.start)} />
        </Sequence>
      ))}
      {p.end ? (
        <Sequence from={fr(p.end.start)} durationInFrames={fr(p.end.end - p.end.start)}>
          <EndView e={p.end} b={b} t={t} dur={fr(p.end.end - p.end.start)} />
        </Sequence>
      ) : null}
      <Logo b={b} opacity={logoOp} />
      {p.audio.narration ? <Audio src={staticFile(p.audio.narration)} /> : null}
      {p.audio.music ? <Audio src={staticFile(p.audio.music)} volume={p.audio.musicVolume ?? 0.12} /> : null}
    </AbsoluteFill>
  );
};
