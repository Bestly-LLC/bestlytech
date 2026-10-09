import { useEffect } from 'react';

export function ElevenLabsWidget() {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://elevenlabs.io/convai/widget/index.js';
    script.async = true;
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, []);

  return (
    <elevenlabs-convai
      widget-id="agent_0301m44te1qffk08jd2cqwtgy1th"
      style={
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        width: '60px',
        height: '60px',
        background: 'rgba(255,255,255,0.8)',
        backdropFilter: 'blur(10px)',
        borderRadius: '50%',
        border: '1px solid rgba(0,0,0,0.1)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }
    />
  );
}
