import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { GradientText } from "@/components/ui/GradientText";
import { SERVICES } from "./ThirteenServices";

gsap.registerPlugin(ScrollTrigger);

/**
 * CloudServicesReveal — Scene 2 of the /cloud 3D story.
 *
 * Picks up where the hero's bird's-eye ended (spatial continuity): the open
 * device, seen from above, pinned center. As you scroll, the thirteen service
 * chips launch out of the open chassis one at a time and snap into a ring
 * around it — "everything your team rents comes out of this one box."
 *
 * GSAP ScrollTrigger pin + scrub drives both the DOM chips and the WebGL
 * turntable. Rendering pauses while the scene is offscreen. Under
 * prefers-reduced-motion the scene renders as a static composed frame
 * (no pin, chips in their final ring).
 */

const RING_RADIUS_PCT = 38; // ring radius as % of stage size

export function CloudServicesReveal() {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!section || !stage || !canvas) return;

    // ── Three.js: the open device, top-down ─────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe3ee, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 8, 2);
    scene.add(key);

    const device = new THREE.Group();
    scene.add(device);

    const disposables: Array<{ dispose: () => void }> = [{ dispose: () => pmrem.dispose() }, envTex];
    let cancelled = false;
    const draco = new DRACOLoader();
    draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.load("/models/device-web-split.glb", (gltf) => {
      if (cancelled) return;
      const model = gltf.scene;
      const lid = model.getObjectByName("lid");
      if (lid) lid.visible = false; // open box — internals only, like the hero's last frame
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      model.scale.setScalar(1.9 / Math.max(size.x, size.y, size.z));
      box.setFromObject(model);
      model.position.sub(box.getCenter(new THREE.Vector3()));
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          if (mesh.geometry) disposables.push(mesh.geometry);
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => m && disposables.push(m));
        }
      });
      device.add(model);
      renderOnce();
    });
    disposables.push(draco);

    // Bird's-eye, matching the hero's end state
    camera.position.set(0, 5.1, 0.75);
    camera.lookAt(0, 0, 0);

    const progress = { value: reduce ? 1 : 0 };

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
    const frame = () => {
      resize();
      const p = progress.value;
      device.rotation.y = -Math.PI / 2 + p * 0.35;
      device.scale.setScalar(0.92 + p * 0.08);
      renderer.render(scene, camera);
      if (running) raf = requestAnimationFrame(frame);
    };
    const renderOnce = () => { if (!running) { resize(); frame(); } };
    const start = () => { if (!running) { running = true; raf = requestAnimationFrame(frame); } };
    const stop = () => { running = false; cancelAnimationFrame(raf); };

    window.addEventListener("resize", resize);

    // ── GSAP: chips launch out of the chassis ───────────────────────────────
    const chips = chipRefs.current.filter(Boolean) as HTMLDivElement[];
    const ctx = gsap.context(() => {
      if (reduce) {
        renderOnce();
        return; // static composition: chips already sit in their ring
      }
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: "+=170%",
          scrub: 0.6,
          pin: true,
          invalidateOnRefresh: true,
          onToggle: (self) => (self.isActive ? start() : stop()),
        },
      });

      // WebGL turntable follows the same scrub
      tl.to(progress, { value: 1, duration: 1.1, ease: "none" }, 0);

      // Each chip: rises out of the open chassis, arcs to its ring slot
      chips.forEach((chip, i) => {
        tl.from(
          chip,
          {
            x: () => {
              const s = stage.getBoundingClientRect();
              const c = chip.getBoundingClientRect();
              return s.left + s.width / 2 - (c.left + c.width / 2);
            },
            y: () => {
              const s = stage.getBoundingClientRect();
              const c = chip.getBoundingClientRect();
              return s.top + s.height * 0.52 - (c.top + c.height / 2);
            },
            scale: 0.18,
            opacity: 0,
            ease: "back.out(1.5)",
            duration: 0.42,
          },
          0.06 + i * 0.052
        );
      });

      // Headline lands once the box is empty
      tl.from(headRef.current, { opacity: 0, y: 28, duration: 0.3, ease: "power2.out" }, 0.82);
    }, section);

    return () => {
      cancelled = true;
      stop();
      ctx.revert();
      window.removeEventListener("resize", resize);
      scene.environment = null;
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    };
  }, [reduce]);

  return (
    <section ref={sectionRef} className="relative overflow-hidden border-t border-border" aria-label="Thirteen services come out of one device">
      <div className="flex h-screen flex-col items-center justify-center">
        <div ref={stageRef} className="relative aspect-square w-full max-w-[640px] scale-[0.85] sm:scale-100">
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
          {SERVICES.map((s, i) => {
            const ang = (2 * Math.PI / SERVICES.length) * i - Math.PI / 2;
            const x = 50 + RING_RADIUS_PCT * Math.cos(ang);
            const y = 50 + RING_RADIUS_PCT * Math.sin(ang);
            return (
              <div
                key={s.title}
                ref={(el) => (chipRefs.current[i] = el)}
                className="absolute flex w-[84px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 text-center will-change-transform"
                style={{ left: `${x}%`, top: `${y}%` }}
              >
                <div className="flex h-[46px] w-[46px] items-center justify-center rounded-[14px] border border-border bg-card/90 shadow-premium backdrop-blur-sm">
                  <s.icon className="h-5 w-5 text-primary" />
                </div>
                <span className="rounded-full bg-background/70 px-2 py-0.5 text-[10.5px] font-semibold leading-tight text-foreground backdrop-blur-sm">
                  {s.title}
                </span>
              </div>
            );
          })}
        </div>
        <div ref={headRef} className="pointer-events-none relative z-10 -mt-4 px-6 text-center">
          <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Thirteen services.{" "}
            <GradientText as="span" className="animate-gradient-flow">Out of one small box.</GradientText>
          </h2>
        </div>
      </div>
    </section>
  );
}
