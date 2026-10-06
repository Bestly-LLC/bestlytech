// Bestly Montage: one vertical short for any product (art direction: quiet cards, the brand's own card kit).
// Generalized from HokuShort: palettes, fonts, wordmark/logo and the closing-card art arrive in the `brand` prop,
// so InventoryProof, Cookie Yeti and Bestly Cloud each look like their own Instagram cards. Lives outside the
// OpenMontage tree (/opt/bestly/montage) and is copied in at render time.
import React, {useEffect, useState} from 'react';
import {
  AbsoluteFill, Audio, CalculateMetadataFunction, Img, OffthreadVideo, Sequence, continueRender, delayRender,
  interpolate, spring, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';

export type Scene = {kicker?: string; line: string; sub?: string; start: number; end: number; clip?: string};
export type EndCard = {title: string; sub?: string; cta: string; start: number; end: number};
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
  end: {image?: string; imageHeight?: number; imageRadius?: number; handle?: string};
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
        <div style={{transform: `translateY(${drift}px)`, marginTop: -100}}>
          {s.kicker ? (
            <Rise delay={0} dur={dur}>
              <div style={{fontFamily: b.label.family, fontWeight: b.label.weight, fontSize: 34, letterSpacing: '0.16em', textTransform: 'uppercase', color: t.accent}}>
                {s.kicker}
              </div>
              <div style={{height: 3, width: 150 * rule, background: t.accent, opacity: 0.7, margin: '30px 0 46px'}} />
            </Rise>
          ) : null}
          <Rise delay={5} dur={dur}>
            <div style={{fontFamily: b.head.family, fontWeight: b.head.weight, fontSize: size, lineHeight: 1.1, letterSpacing: b.head.spacing,
                         color: t.head || t.ink, maxWidth: 888, overflowWrap: 'break-word'}}>
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

const EndView: React.FC<{e: EndCard; b: Brand; t: Theme; dur: number}> = ({e, b, t, dur}) => {
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
        <div style={{fontFamily: b.head.family, fontWeight: b.head.weight, fontSize: 112, lineHeight: 1.1, letterSpacing: b.head.spacing, color: t.head || t.ink}}>{e.title}</div>
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

const Logo: React.FC<{b: Brand}> = ({b}) => {
  const l = b.logo;
  if (l.image) {
    return <Img src={staticFile(l.image)} style={{position: 'absolute', left: 96, top: 120, height: l.height ?? 76, mixBlendMode: (l.blend as any) || 'normal'}} />;
  }
  if (l.wordmark) {
    const w = l.wordmark;
    return (
      <div style={{position: 'absolute', left: 96, top: 128}}>
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
  const {fps} = useVideoConfig();
  const name = b.themes[p.theme] ? p.theme : Object.keys(b.themes)[0];
  const t = b.themes[name];
  const fr = (sec: number) => Math.round(sec * fps);
  return (
    <AbsoluteFill style={{background: t.bg}}>
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
      <Logo b={b} />
      {p.audio.narration ? <Audio src={staticFile(p.audio.narration)} /> : null}
      {p.audio.music ? <Audio src={staticFile(p.audio.music)} volume={p.audio.musicVolume ?? 0.12} /> : null}
    </AbsoluteFill>
  );
};
