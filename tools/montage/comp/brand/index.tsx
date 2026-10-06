import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {BrandShort, brandMeta, BrandProps} from './BrandShort';

const defaults: BrandProps = {
  brand: {
    fonts: [], head: {family: 'sans-serif', weight: 700, sizes: [104, 92, 80], spacing: '-0.01em'},
    label: {family: 'sans-serif', weight: 600},
    themes: {x: {bg: '#111', veil: '#111111', ink: '#fff', dim: '#bbb', accent: '#8b9bf0', head: '#fff'}},
    logo: {}, end: {},
  },
  theme: 'x', scenes: [], end: null, audio: {},
};

const Root: React.FC = () => (
  <Composition
    id="BrandShort"
    component={BrandShort}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={900}
    defaultProps={defaults}
    calculateMetadata={brandMeta}
  />
);

registerRoot(Root);
