// Bestly Montage: HOKU vertical short (art direction: quiet editorial cards, HOKU card kit palette + type).
// 2026-10-13 (unique content, docs/studio-unique-content-opusplan.md): scene templates (stack, center, split, stat, steps), two closing-card layouts
// (claim, list), an accent per video, a quiet series tag and a Next tease; all optional, old props draw as before.
// Hand-authored for HOKU; lives outside the OpenMontage tree (/opt/bestly/montage) and is copied in at render time.
import React, {useEffect, useState} from 'react';
import {
  AbsoluteFill, Audio, CalculateMetadataFunction, Img, OffthreadVideo, Sequence, continueRender, delayRender,
  interpolate, spring, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';

export type Scene = {kicker?: string; line: string; sub?: string; start: number; end: number; clip?: string;
                     layout?: 'stack' | 'center' | 'split' | 'stat' | 'steps'; big?: string; items?: string[]};
export type EndCard = {title: string; cta: string; start: number; end: number; layout?: 'claim' | 'list' | 'qa'; tease?: string; follow?: string};
export type Look = {accent?: string | null; series?: string | null};
export type HokuProps = {
  theme: string;
  look?: Look;
  scenes: Scene[];
  end: EndCard | null;
  audio: {narration?: string; music?: string; musicVolume?: number};
};

// Same palette as /opt/bestly/hoku-kit/card.html, so the videos sit beside the posts.
const THEMES: Record<string, {bg: string; ink: string; dim: string; accent: string; line: string; logo: 'dark' | 'light'}> = {
  gold:   {bg: '#C29A55', ink: '#292010', dim: '#3D3218', accent: '#4A3A18', line: 'rgba(41,32,16,.28)', logo: 'dark'},
  forest: {bg: '#25301F', ink: '#F6F2E9', dim: '#C6CEBB', accent: '#CBA76C', line: 'rgba(246,242,233,.22)', logo: 'light'},
  sage:   {bg: '#9EB4A7', ink: '#101B15', dim: '#2C3A31', accent: '#33463A', line: 'rgba(16,27,21,.25)', logo: 'dark'},
  brown:  {bg: '#6A4A33', ink: '#FFF6EA', dim: '#E2D4C4', accent: '#D9B683', line: 'rgba(255,246,234,.22)', logo: 'light'},
  paper:  {bg: '#F6F2E9', ink: '#25301F', dim: '#4A5742', accent: '#8A6A34', line: 'rgba(37,48,31,.18)', logo: 'dark'},
};

export const hokuMeta: CalculateMetadataFunction<HokuProps> = async ({props}) => {
  const last = Math.max(props.end ? props.end.end : 0, ...props.scenes.map((s) => s.end), 1);
  return {durationInFrames: Math.ceil(last * 30)};
};

const useFonts = () => {
  const [handle] = useState(() => delayRender('hoku fonts'));
  useEffect(() => {
    const faces = [
      new FontFace('Newsreader', `url(${staticFile('fonts/newsreader.woff2')})`, {weight: '200 800'}),
      new FontFace('Inter', `url(${staticFile('fonts/inter-400.woff2')})`, {weight: '400'}),
      new FontFace('Inter', `url(${staticFile('fonts/inter-600.woff2')})`, {weight: '600'}),
    ];
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

type Theme = (typeof THEMES)[string];

const Kicker: React.FC<{s: Scene; t: Theme; dur: number; center?: boolean}> = ({s, t, dur, center}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const rule = spring({frame: f - 6, fps, config: {damping: 200, stiffness: 60}});
  if (!s.kicker) return null;
  return (
    <Rise delay={0} dur={dur} style={center ? {display: 'flex', flexDirection: 'column', alignItems: 'center'} : undefined}>
      <div style={{fontFamily: 'Inter', fontWeight: 600, fontSize: 34, letterSpacing: '0.16em', textTransform: 'uppercase', color: t.accent}}>{s.kicker}</div>
      <div style={{height: 3, width: 150 * rule, background: t.accent, opacity: 0.55, margin: '30px 0 46px'}} />
    </Rise>
  );
};

const Line: React.FC<{s: Scene; t: Theme; dur: number; scale?: number; center?: boolean; delay?: number}> = ({s, t, dur, scale = 1, center, delay = 5}) => {
  const size = Math.round((s.line.length > 44 ? 88 : s.line.length > 28 ? 100 : 116) * scale);
  return (
    <Rise delay={delay} dur={dur}>
      <div style={{fontFamily: 'Newsreader', fontWeight: 400, fontSize: size, lineHeight: 1.1, letterSpacing: '-0.01em', color: t.ink, maxWidth: 900,
                   textAlign: center ? 'center' : 'left'}}>{s.line}</div>
    </Rise>
  );
};

const SceneView: React.FC<{s: Scene; t: Theme; dur: number}> = ({s, t, dur}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const drift = interpolate(f, [0, dur], [0, -16]);                  // slow upward drift keeps a still card alive
  const lay = s.layout || 'stack';
  // b-roll: dissolves in and out through the brand color, under a veil of it so the line always reads
  const clipIn = interpolate(f, [0, 8, dur - 8, dur], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const zoom = interpolate(f, [0, dur], [1.0, 1.06]);
  const bg = s.clip ? (
    <AbsoluteFill style={{opacity: clipIn}}>
      <OffthreadVideo src={staticFile(s.clip)} muted
                      style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})`}} />
      <AbsoluteFill style={{background: `linear-gradient(180deg, ${t.bg}8C 0%, ${t.bg}D9 42%, ${t.bg}D9 62%, ${t.bg}99 100%)`}} />
    </AbsoluteFill>
  ) : null;
  const sub = s.sub ? (
    <Rise delay={12} dur={dur}>
      <div style={{fontFamily: 'Inter', fontSize: 44, lineHeight: 1.36, color: t.dim, marginTop: 46, maxWidth: 860}}>{s.sub}</div>
    </Rise>
  ) : null;
  if (lay === 'center') {
    return (
      <AbsoluteFill>
        {bg}
        <AbsoluteFill style={{padding: '0 96px', justifyContent: 'center', alignItems: 'center'}}>
          <div style={{transform: `translateY(${drift}px)`, marginTop: -100, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
            <Kicker s={s} t={t} dur={dur} center />
            <Line s={s} t={t} dur={dur} center />
            {sub}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  if (lay === 'split') {
    const hair = spring({frame: f - 4, fps, config: {damping: 200, stiffness: 50}});
    return (
      <AbsoluteFill>
        {bg}
        <AbsoluteFill style={{padding: '0 96px', justifyContent: 'flex-start'}}>
          <div style={{transform: `translateY(${drift}px)`, marginTop: 330}}>
            <Kicker s={s} t={t} dur={dur} />
            <Line s={s} t={t} dur={dur} />
            {sub}
          </div>
        </AbsoluteFill>
        <div style={{position: 'absolute', left: 96, right: 96, top: 1180, height: 2, transform: `scaleX(${hair})`, transformOrigin: 'left center',
                     background: `linear-gradient(90deg, ${t.accent}, transparent)`, opacity: 0.6}} />
        <div style={{position: 'absolute', left: 540 - 380, top: 1500 - 380, width: 760, height: 760, opacity: 0.7 * Math.min(1, hair),
                     background: `radial-gradient(circle, ${t.accent}44 0%, ${t.accent}16 42%, ${t.accent}00 68%)`, transform: `scale(${1 + 0.04 * Math.sin(f / 22)})`}} />
      </AbsoluteFill>
    );
  }
  if (lay === 'stat' && s.big) {
    const pop = spring({frame: f - 3, fps, config: {damping: 13, stiffness: 95, mass: 0.9}});
    const out = interpolate(f, [dur - 10, dur], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
    const sz = s.big.length <= 5 ? 360 : s.big.length <= 8 ? 280 : s.big.length <= 12 ? 210 : 160;
    return (
      <AbsoluteFill>
        {bg}
        <AbsoluteFill style={{padding: '0 96px', justifyContent: 'center'}}>
          <div style={{transform: `translateY(${drift}px)`, marginTop: -80}}>
            <Kicker s={s} t={t} dur={dur} />
            <div style={{fontFamily: 'Newsreader', fontWeight: 400, fontSize: sz, lineHeight: 0.98, letterSpacing: '-0.02em', color: t.accent, maxWidth: 888,
                         opacity: Math.min(1, pop) * out, transform: `scale(${0.84 + 0.16 * Math.min(1.04, pop)})`, transformOrigin: 'left center'}}>{s.big}</div>
            <div style={{height: 54}} />
            <Line s={s} t={t} dur={dur} scale={0.8} delay={14} />
            {sub}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  if (lay === 'steps' && s.items && s.items.length >= 2) {
    return (
      <AbsoluteFill>
        {bg}
        <AbsoluteFill style={{padding: '0 96px', justifyContent: 'center'}}>
          <div style={{transform: `translateY(${drift}px)`, marginTop: -70}}>
            <Kicker s={s} t={t} dur={dur} />
            <Line s={s} t={t} dur={dur} scale={0.86} />
            <div style={{display: 'flex', flexDirection: 'column', gap: 40, marginTop: 70}}>
              {s.items.slice(0, 3).map((it, i) => {
                const k = spring({frame: f - (18 + i * 13), fps, config: {damping: 16, stiffness: 85, mass: 0.9}});
                const o = Math.min(1, k) * interpolate(f, [dur - 10, dur], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
                return (
                  <div key={i} style={{display: 'flex', alignItems: 'center', gap: 36, opacity: o, transform: `translateX(${(1 - k) * -70}px)`}}>
                    <div style={{width: 96, height: 96, flex: '0 0 96px', borderRadius: '50%', boxShadow: `inset 0 0 0 3px ${t.accent}`, display: 'flex', alignItems: 'center',
                                 justifyContent: 'center', fontFamily: 'Newsreader', fontSize: 56, color: t.accent}}>{i + 1}</div>
                    <div style={{fontFamily: 'Inter', fontWeight: 600, fontSize: 54, lineHeight: 1.12, color: t.ink, maxWidth: 740}}>{it}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill>
      {bg}
      <AbsoluteFill style={{padding: '0 96px', justifyContent: 'center'}}>
        <div style={{transform: `translateY(${drift}px)`, marginTop: -100}}>
          <Kicker s={s} t={t} dur={dur} />
          <Line s={s} t={t} dur={dur} />
          {sub}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const EndFooter: React.FC<{e: EndCard; t: Theme}> = ({e, t}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame: f - 44, fps, config: {damping: 18, stiffness: 80, mass: 0.9}});
  const o = Math.min(1, s);
  if (!e.tease && !e.follow) return null;
  return (
    <div style={{position: 'absolute', left: 0, right: 0, bottom: 150, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, opacity: o, transform: `translateY(${(1 - o) * 26}px)`}}>
      {e.tease ? (
        <div style={{display: 'flex', alignItems: 'baseline', gap: 20, padding: '14px 40px', borderRadius: 999, maxWidth: 940, background: `${t.accent}22`}}>
          <div style={{fontFamily: 'Inter', fontWeight: 600, fontSize: 28, letterSpacing: '0.18em', textTransform: 'uppercase', color: t.accent}}>Next</div>
          <div style={{fontFamily: 'Newsreader', fontSize: 44, lineHeight: 1.15, color: t.ink}}>{e.tease}</div>
        </div>
      ) : null}
      {e.follow ? <div style={{fontFamily: 'Inter', fontSize: 34, color: t.dim}}>{e.follow}</div> : null}
    </div>
  );
};

const EndView: React.FC<{e: EndCard; t: Theme; theme: string; dur: number}> = ({e, t, theme, dur}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const up = spring({frame: f - 8, fps, config: {damping: 200, stiffness: 55}});
  const hold = dur + 30;                                               // no fade-out on the last card
  const tz = !!e.tease || !!e.follow;
  const list = e.layout === 'list';                                    // list: the can first, the line under it; claim: the line first, the can under it
  const canH = tz ? 660 : 820;
  return (
    <AbsoluteFill style={{alignItems: 'center'}}>
      <Rise delay={0} dur={hold} style={list ? {position: 'absolute', bottom: tz ? 560 : 480, textAlign: 'center', padding: '0 100px'} : {marginTop: tz ? 230 : 250, textAlign: 'center', padding: '0 100px'}}>
        <div style={{fontFamily: 'Newsreader', fontWeight: 400, fontSize: list ? 84 : 96, lineHeight: 1.12, color: t.ink}}>{e.title}</div>
      </Rise>
      <Img
        src={staticFile(`art/hoku-can-${theme}.png`)}
        style={list ? {position: 'absolute', top: 250, height: tz ? 780 : 900, opacity: up, transform: `translateY(${(1 - up) * -300}px)`}
                    : {position: 'absolute', bottom: tz ? 420 : 300, height: canH, opacity: up, transform: `translateY(${(1 - up) * 420}px)`}}
      />
      <Rise delay={22} dur={hold} style={{position: 'absolute', bottom: tz ? 320 : 180, width: '100%', textAlign: 'center'}}>
        <div style={{fontFamily: 'Inter', fontWeight: 600, fontSize: 40, letterSpacing: '0.03em', color: t.ink}}>{e.cta}</div>
      </Rise>
      <EndFooter e={e} t={t} />
    </AbsoluteFill>
  );
};

export const HokuShort: React.FC<HokuProps> = (p) => {
  useFonts();
  const {fps} = useVideoConfig();
  const name = THEMES[p.theme] ? p.theme : 'paper';
  const look = p.look || {};
  const t: Theme = {...THEMES[name], ...(look.accent ? {accent: look.accent} : {})};
  const fr = (sec: number) => Math.round(sec * fps);
  const f = useCurrentFrame();
  const tagOp = p.end ? interpolate(f, [fr(p.end.start) - 6, fr(p.end.start)], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) : 1;
  return (
    <AbsoluteFill style={{background: t.bg}}>
      {p.scenes.map((s, i) => (
        <Sequence key={i} from={fr(s.start)} durationInFrames={fr(s.end - s.start)}>
          <SceneView s={s} t={t} dur={fr(s.end - s.start)} />
        </Sequence>
      ))}
      {p.end ? (
        <Sequence from={fr(p.end.start)} durationInFrames={fr(p.end.end - p.end.start)}>
          <EndView e={p.end} t={t} theme={name} dur={fr(p.end.end - p.end.start)} />
        </Sequence>
      ) : null}
      <Img src={staticFile(t.logo === 'light' ? 'lockup_w.webp' : 'lockup.webp')}
           style={{position: 'absolute', left: 96, top: 132, height: 52, opacity: 0.92}} />
      {look.series ? (
        <div style={{position: 'absolute', right: 96, top: 146, opacity: 0.8 * tagOp * interpolate(f, [4, 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
                     fontFamily: 'Inter', fontWeight: 600, fontSize: 28, letterSpacing: '0.2em', textTransform: 'uppercase', color: t.dim}}>{look.series}</div>
      ) : null}
      {p.audio.narration ? <Audio src={staticFile(p.audio.narration)} /> : null}
      {p.audio.music ? <Audio src={staticFile(p.audio.music)} volume={p.audio.musicVolume ?? 0.12} /> : null}
    </AbsoluteFill>
  );
};
