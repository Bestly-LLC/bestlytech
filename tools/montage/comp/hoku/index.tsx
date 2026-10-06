import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {HokuShort, hokuMeta, HokuProps} from './HokuShort';

const defaults: HokuProps = {theme: 'paper', scenes: [], end: null, audio: {}};

const Root: React.FC = () => (
  <Composition
    id="HokuShort"
    component={HokuShort}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={900}
    defaultProps={defaults}
    calculateMetadata={hokuMeta}
  />
);

registerRoot(Root);
