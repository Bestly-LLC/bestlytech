import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Lock } from "lucide-react";
import { loadDeviceGLTF } from "./deviceModel";

/**
 * CloudPrivacySeal — Scene 3 of the /cloud 3D story.
 *
 * The reverse of the hero: as you scroll, the lid lowers and SEALS the
 * device shut, an indigo pulse sweeps out when it seats, and the privacy
 * promise lands beside it. "Your data never leaves the building" — shown,
 * not told. Manual scrub (no ScrollTrigger pin — transformed ancestors
 * break it); sticky stage, same pattern as the hero.
 */

const LID_OPEN_Y = 0.26;
// Past the baked seam — the lid skirt drops over the side vent band so the
// case reads fully shut.
const LID_CLOSED_Y = -0.3;

export function CloudPrivacySeal() {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pulseRef = useRef<HTMLDivElement>(null);
  const sealRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const canvas = canvasRef.current;
    if (!section || !canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 1.5, 5.0);
    camera.lookAt(0, -0.05, 0);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe3ee, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(4, 6, 4);
    scene.add(key);
    const rim = new THREE.PointLight(0x7a8be0, 0, 14);
    rim.position.set(-2.5, 1.5, -3);
    scene.add(rim);

    const device = new THREE.Group();
    device.rotation.set(0.06, -0.55, 0);
    scene.add(device);

    const disposables: Array<{ dispose: () => void }> = [{ dispose: () => pmrem.dispose() }, envTex];
    let cancelled = false;
    let lid: THREE.Object3D | null = null;
    loadDeviceGLTF().then((gltf) => {
      if (cancelled) return;
      const model = gltf.scene.clone(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      model.scale.setScalar(2.0 / Math.max(size.x, size.y, size.z));
      box.setFromObject(model);
      model.position.sub(box.getCenter(new THREE.Vector3()));
      model.position.y -= 0.16;
      lid = model.getObjectByName("lid") ?? null;
      if (lid) lid.position.y = reduce ? LID_CLOSED_Y : LID_OPEN_Y;
      device.add(model);
      renderOnce();
    });

    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
    };

    const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
    const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    let target = 0;
    let smooth = reduce ? 1 : 0;
    const onScroll = () => {
      const total = section.offsetHeight - window.innerHeight;
      target = total > 0 ? clamp01(-section.getBoundingClientRect().top / total) : 0;
    };

    let raf = 0;
    let running = false;
    const apply = (p: number) => {
      // lid closes over the first 70%
      const close = easeInOut(clamp01(p / 0.7));
      if (lid) lid.position.y = LID_OPEN_Y + close * (LID_CLOSED_Y - LID_OPEN_Y);
      device.rotation.y = -0.55 + p * 0.22;
      // seal moment: pulse ring + caption + rim glow flash at ~78%
      const seal = clamp01((p - 0.74) / 0.16);
      rim.intensity = seal * (1 - seal) * 14; // flash up then settle
      if (pulseRef.current) {
        pulseRef.current.style.opacity = String(seal > 0 ? (1 - seal) * 0.8 : 0);
        pulseRef.current.style.transform = `translate(-50%, -50%) scale(${0.6 + seal * 1.1})`;
      }
      if (sealRef.current) sealRef.current.style.opacity = String(clamp01((p - 0.82) / 0.12));
      renderer.render(scene, camera);
    };
    const frame = () => {
      resize();
      smooth += (target - smooth) * 0.14;
      apply(reduce ? 1 : smooth);
      if (running) raf = requestAnimationFrame(frame);
    };
    const renderOnce = () => { if (!running) { resize(); frame(); } };
    const start = () => { if (!running) { running = true; raf = requestAnimationFrame(frame); } };
    const stop = () => { running = false; cancelAnimationFrame(raf); };

    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), { threshold: 0 });
    io.observe(section);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", resize);
    onScroll();
    smooth = reduce ? 1 : target;

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__sealSetP = (v: number) => {
        target = v; smooth = v;
        const wasRunning = running; running = false; resize(); apply(v); running = wasRunning;
      };
    }

    return () => {
      cancelled = true;
      stop();
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", resize);
      scene.environment = null;
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    };
  }, [reduce]);

  return (
    <section
      ref={sectionRef}
      className={`relative border-t border-border bg-secondary/10 ${reduce ? "" : "h-[200vh]"}`}
      aria-label="The lid seals shut — your data never leaves the building"
    >
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-6 lg:grid-cols-2 lg:px-8">
          {/* Copy */}
          <div className="relative z-10 order-2 text-center lg:order-1 lg:text-left">
            <div className="mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(var(--gradient-start)/0.14)] to-[hsl(var(--gradient-end)/0.14)] lg:mx-0">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Close the lid.{" "}
              <span className="text-primary">That's your whole cloud.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-md text-lg leading-relaxed text-muted-foreground lg:mx-0">
              We never sell, share, or retain your data. It lives on hardware in
              your office — Bestly can't see it, and there's nothing for us to
              monetize.
            </p>
            <span
              ref={sealRef}
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/5 px-4 py-1.5 text-sm font-semibold text-primary"
              style={{ opacity: 0 }}
            >
              <Lock className="h-3.5 w-3.5" />
              Sealed. Nothing leaves the building.
            </span>
          </div>
          {/* Device */}
          <div className="relative order-1 mx-auto aspect-square w-full lg:order-2" style={{ maxWidth: "min(78vw, 520px, 40vh)" }}>
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
            <div
              ref={pulseRef}
              className="pointer-events-none absolute left-1/2 top-1/2 h-[72%] w-[72%] rounded-full border-2 border-[hsl(var(--glow-color)/0.7)]"
              style={{ opacity: 0, transform: "translate(-50%, -50%) scale(0.6)" }}
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
