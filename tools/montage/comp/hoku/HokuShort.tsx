// Bestly Montage: HOKU vertical short (art direction: quiet editorial cards, HOKU card kit palette + type).
// Hand-authored for HOKU; lives outside the OpenMontage tree (/opt/bestly/montage) and is copied in at render time.
import React, {useEffect, useState} from 'react';
import {
  AbsoluteFill, Audio, CalculateMetadataFunction, Img, OffthreadVideo, Sequence, continueRender, delayRender,
  interpolate, spring, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';

export type Scene = {kicker?: string; line: string; sub?: string; start: number; end: number; clip?: string};
export type EndCard = {title: string; cta: string; start: number; end: number};
export type HokuProps = {
  theme: string;
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

const SceneView: React.FC<{s: Scene; t: Theme; dur: number}> = ({s, t, dur}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const drift = interpolate(f, [0, dur], [0, -16]);                  // slow upward drift keeps a still card alive
  const rule = spring({frame: f - 6, fps, config: {damping: 200, stiffness: 60}});
  const size = s.line.length > 44 ? 88 : s.line.length > 28 ? 100 : 116;
  // b-roll: dissolves in and out through the brand color, under a veil of it so the line always reads
  const clipIn = interpolate(f, [0, 8, dur - 8, dur], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const zoom = interpolate(f, [0, dur], [1.0, 1.06]);
  return (
    <AbsoluteFill>
      {s.clip ? (
        <AbsoluteFill style={{opacity: clipIn}}>
          <OffthreadVideo src={staticFile(s.clip)} muted
                          style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})`}} />
          <AbsoluteFill style={{background: `linear-gradient(180deg, ${t.bg}8C 0%, ${t.bg}D9 42%, ${t.bg}D9 62%, ${t.bg}99 100%)`}} />
        </AbsoluteFill>
      ) : null}
    <AbsoluteFill style={{padding: '0 96px', justifyContent: 'center'}}>
      <div style={{transform: `translateY(${drift}px)`, marginTop: -100}}>
        {s.kicker ? (
          <Rise delay={0} dur={dur}>
            <div style={{fontFamily: 'Inter', fontWeight: 600, fontSize: 34, letterSpacing: '0.16em', textTransform: 'uppercase', color: t.accent}}>
              {s.kicker}
            </div>
            <div style={{height: 3, width: 150 * rule, background: t.accent, opacity: 0.55, margin: '30px 0 46px'}} />
          </Rise>
        ) : null}
        <Rise delay={5} dur={dur}>
          <div style={{fontFamily: 'Newsreader', fontWeight: 400, fontSize: size, lineHeight: 1.1, letterSpacing: '-0.01em', color: t.ink, maxWidth: 900}}>
            {s.line}
          </div>
        </Rise>
        {s.sub ? (
          <Rise delay={12} dur={dur}>
            <div style={{fontFamily: 'Inter', fontSize: 44, lineHeight: 1.36, color: t.dim, marginTop: 46, maxWidth: 860}}>{s.sub}</div>
          </Rise>
        ) : null}
      </div>
    </AbsoluteFill>
    </AbsoluteFill>
  );
};

const EndView: React.FC<{e: EndCard; t: Theme; theme: string; dur: number}> = ({e, t, theme, dur}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const up = spring({frame: f - 8, fps, config: {damping: 200, stiffness: 55}});
  const hold = dur + 30;                                               // no fade-out on the last card
  return (
    <AbsoluteFill style={{alignItems: 'center'}}>
      <Rise delay={0} dur={hold} style={{marginTop: 250, textAlign: 'center', padding: '0 100px'}}>
        <div style={{fontFamily: 'Newsreader', fontWeight: 400, fontSize: 96, lineHeight: 1.12, color: t.ink}}>{e.title}</div>
      </Rise>
      <Img
        src={staticFile(`art/hoku-can-${theme}.png`)}
        style={{position: 'absolute', bottom: 300, height: 820, opacity: up, transform: `translateY(${(1 - up) * 420}px)`}}
      />
      <Rise delay={22} dur={hold} style={{position: 'absolute', bottom: 180, width: '100%', textAlign: 'center'}}>
        <div style={{fontFamily: 'Inter', fontWeight: 600, fontSize: 40, letterSpacing: '0.03em', color: t.ink}}>{e.cta}</div>
      </Rise>
    </AbsoluteFill>
  );
};

export const HokuShort: React.FC<HokuProps> = (p) => {
  useFonts();
  const {fps} = useVideoConfig();
  const name = THEMES[p.theme] ? p.theme : 'paper';
  const t = THEMES[name];
  const fr = (sec: number) => Math.round(sec * fps);
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
      {p.audio.narration ? <Audio src={staticFile(p.audio.narration)} /> : null}
      {p.audio.music ? <Audio src={staticFile(p.audio.music)} volume={p.audio.musicVolume ?? 0.12} /> : null}
    </AbsoluteFill>
  );
};
