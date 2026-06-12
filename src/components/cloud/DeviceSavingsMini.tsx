import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { loadDeviceGLTF } from "./deviceModel";

/**
 * DeviceSavingsMini — the calculator's living payback meter.
 *
 * A small idle-rotating device whose indigo rim glow brightens with the
 * visitor's savings. Pure micro-interaction (no scroll scrub); rendering
 * pauses offscreen.
 */

export function DeviceSavingsMini({ intensity }: { intensity: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intensityRef = useRef(intensity);
  intensityRef.current = Math.min(1, Math.max(0, intensity));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.7, 5.4);
    camera.lookAt(0, -0.05, 0);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe3ee, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 6, 4);
    scene.add(key);
    const rim = new THREE.PointLight(0x7a8be0, 0.4, 12);
    rim.position.set(-2.2, 1.2, -2.6);
    scene.add(rim);

    const device = new THREE.Group();
    device.rotation.set(0.06, -0.5, 0);
    scene.add(device);

    const disposables: Array<{ dispose: () => void }> = [{ dispose: () => pmrem.dispose() }, envTex];
    let cancelled = false;
    loadDeviceGLTF().then((gltf) => {
      if (cancelled) return;
      const model = gltf.scene.clone(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      model.scale.setScalar(2.1 / Math.max(size.x, size.y, size.z));
      box.setFromObject(model);
      model.position.sub(box.getCenter(new THREE.Vector3()));
      const lid = model.getObjectByName("lid");
      if (lid) lid.position.y = -0.3; // fully closed — skirt covers the vent band
      device.add(model);
    });

    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
    };

    let raf = 0;
    let running = false;
    let t = 0;
    const frame = () => {
      resize();
      t += 0.004;
      device.rotation.y = -0.5 + Math.sin(t) * 0.3;
      rim.intensity = 0.4 + intensityRef.current * 3.4;
      renderer.render(scene, camera);
      if (running) raf = requestAnimationFrame(frame);
    };
    const start = () => { if (!running) { running = true; raf = requestAnimationFrame(frame); } };
    const stop = () => { running = false; cancelAnimationFrame(raf); };

    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), { threshold: 0 });
    io.observe(canvas);

    return () => {
      cancelled = true;
      stop();
      io.disconnect();
      scene.environment = null;
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />;
}
