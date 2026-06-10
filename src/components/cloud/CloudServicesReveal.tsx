import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { gsap } from "gsap";
import { GradientText } from "@/components/ui/GradientText";
import { SERVICES } from "./ThirteenServices";

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

const RING_RADIUS_PCT = 42; // ring radius as % of stage size

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
      model.scale.setScalar(1.5 / Math.max(size.x, size.y, size.z));
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

    // Manual scrub: GSAP timeline progress driven by our own scroll math
    // (ScrollTrigger's pin/measure breaks under the page-transition
    // wrapper's CSS transform, so we never rely on it here).
    let tlRef: gsap.core.Timeline | null = null;
    let scrubTarget = 0;
    let scrubSmooth = 0;
    const onScroll = () => {
      const total = section.offsetHeight - window.innerHeight;
      scrubTarget = total > 0 ? Math.min(1, Math.max(0, -section.getBoundingClientRect().top / total)) : 0;
    };

    let raf = 0;
    let running = false;
    const frame = () => {
      resize();
      if (tlRef) {
        scrubSmooth += (scrubTarget - scrubSmooth) * 0.14;
        tlRef.progress(scrubSmooth);
      }
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
      const tl = gsap.timeline({ paused: true });

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
            rotation: i % 2 ? 10 : -10,
            ease: "back.out(1.5)",
            duration: 0.42,
          },
          0.06 + i * 0.052
        );
      });

      // Headline lands once the box is empty
      tl.from(headRef.current, { opacity: 0, y: 28, duration: 0.3, ease: "power2.out" }, 0.82);

      tl.progress(0);
      tlRef = tl;
    }, section);

    // Run the scrub + renderer only while the scene is on screen
    const io = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? start() : stop()),
      { threshold: 0 }
    );
    io.observe(section);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    scrubSmooth = scrubTarget; // no catch-up lurch on first paint

    if (import.meta.env.DEV) {
      // Deterministic frame hook for visual auditing (dev only)
      (window as unknown as Record<string, unknown>).__sceneSetP = (v: number) => {
        scrubTarget = v;
        scrubSmooth = v;
        if (tlRef) tlRef.progress(v);
        const wasRunning = running;
        running = false;
        frame();
        running = wasRunning;
      };
    }

    return () => {
      cancelled = true;
      stop();
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      ctx.revert();
      window.removeEventListener("resize", resize);
      scene.environment = null;
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    };
  }, [reduce]);

  return (
    <section
      ref={sectionRef}
      className={`relative border-t border-border ${reduce ? "" : "h-[270vh]"}`}
      aria-label="Thirteen services come out of one device"
    >
      <div className="sticky top-0 flex h-screen flex-col items-center justify-center overflow-hidden">
        {/* soft stage glow so the device isn't floating in a void */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,hsl(var(--gradient-end)/0.10),transparent_65%)]"
          aria-hidden="true"
        />
        <p className="mb-1 text-sm font-semibold uppercase tracking-widest text-primary">
          What's inside
        </p>
        <div ref={stageRef} className="relative aspect-square" style={{ width: "min(88vw, 640px, 64vh)" }}>
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
        <div ref={headRef} className="pointer-events-none relative z-10 mt-3 px-6 text-center">
          <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Thirteen services.{" "}
            <GradientText as="span" className="animate-gradient-flow">Out of one small box.</GradientText>
          </h2>
        </div>
      </div>
    </section>
  );
}
