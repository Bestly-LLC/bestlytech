import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, ChevronDown } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { gsap } from "gsap";
import { GradientText } from "@/components/ui/GradientText";
import { SERVICES } from "./ThirteenServices";
import { loadDeviceGLTF } from "./deviceModel";

/**
 * CloudScrollHero — Apple-style scroll-scrubbed product hero (Phase 1).
 *
 * A live WebGL render of the Bestly device — the real photoreal GLB
 * (public/models/device-web.glb, Tripo export → draco + webp, 96.7k tris,
 * ~626 KB) — that powers on (rim glow) and turns a full rotation as you
 * scroll through a pinned section. The rotation maps 1:1 to scroll. Under
 * prefers-reduced-motion it collapses to a single static frame.
 */
export function CloudScrollHero() {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const subRef = useRef<HTMLParagraphElement>(null);
  const ebRef = useRef<HTMLParagraphElement>(null);
  const capRef = useRef<HTMLParagraphElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const eyebrowRef = useRef<HTMLParagraphElement>(null);
  const inHeadRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<(HTMLDivElement | null)[]>([]);
  const ctaGroupRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef<HTMLDivElement>(null);
  const progress = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const section = sectionRef.current;
    if (!canvas || !section) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 1.05, 6.2);
    camera.lookAt(0, 0.15, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe3ee, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.radius = 8;
    (key.shadow.camera as THREE.OrthographicCamera).left = -6;
    (key.shadow.camera as THREE.OrthographicCamera).right = 6;
    (key.shadow.camera as THREE.OrthographicCamera).top = 6;
    (key.shadow.camera as THREE.OrthographicCamera).bottom = -6;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xeaecff, 0.55);
    fill.position.set(-5, 3, 2);
    scene.add(fill);
    const rim = new THREE.PointLight(0x7a8be0, 0, 16);
    rim.position.set(-3, 2, -4);
    scene.add(rim);

    const groundMat = new THREE.ShadowMaterial({ opacity: 0.16 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.92;
    ground.receiveShadow = true;
    scene.add(ground);

    const disposables: Array<{ dispose: () => void }> = [];

    // Soft studio environment so the model's PBR metals read correctly.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    disposables.push(envTex, pmrem);

    const device = new THREE.Group();
    device.rotation.set(0.05, -0.5, 0);
    scene.add(device);

    // Real device model, split into named "lid" + "base" nodes
    // (Tripo export → Blender loose-part split → draco + webp, ~387k tris, ~1.8 MB).
    let cancelled = false;
    let lid: THREE.Object3D | null = null;
    // Lid travel in model-local units (model is ~1 unit wide pre-scale):
    // starts almost seated on the base, floats up as you scroll.
    const LID_CLOSED_Y = -0.125;
    const LID_OPEN_Y = 0.55;
    const LID_DRIFT_Z = -1.9; // slides far back as the camera rises — fully out of frame
    let lidMats: THREE.Material[] = [];
    // Shared cached loader: one fetch + one draco decode for the whole page
    // (the seal/dock/mini scenes clone from the same parse).
    loadDeviceGLTF().then((gltf) => {
      if (cancelled) return;
      const model = gltf.scene.clone(true);
      // Normalize: fit largest dimension to ~1.75 world units, center on origin,
      // then sit slightly low so the headline/CTA stay clear.
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      model.scale.setScalar(1.75 / Math.max(size.x, size.y, size.z));
      box.setFromObject(model);
      model.position.sub(box.getCenter(new THREE.Vector3()));
      model.position.y -= 0.2;
      // Keep the model above the shadow ground plane.
      box.setFromObject(model);
      if (box.min.y < -0.88) model.position.y += -0.88 - box.min.y;
      // NOTE: geometries/materials are SHARED with the cached parse used by
      // the seal/dock/mini scenes — never dispose them here. Only hero-owned
      // clones (lid materials below) go into disposables.
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = true;
      });
      if (loadingRef.current) loadingRef.current.style.opacity = "0";
      lid = model.getObjectByName("lid") ?? null;
      if (lid) {
        lid.position.y = LID_CLOSED_Y;
        // Clone materials: the lid shares the body material with the base,
        // and we fade the lid out independently at the top of the arc.
        lid.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            if (Array.isArray(mesh.material)) {
              mesh.material = mesh.material.map((m) => m.clone());
              mesh.material.forEach((m) => { lidMats.push(m); disposables.push(m); });
            } else if (mesh.material) {
              mesh.material = mesh.material.clone();
              lidMats.push(mesh.material);
              disposables.push(mesh.material);
            }
          }
        });
      }
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
    const onScroll = () => {
      const total = section.offsetHeight - window.innerHeight;
      const top = -section.getBoundingClientRect().top;
      progress.current = total > 0 ? Math.min(1, Math.max(0, top / total)) : 0;
    };

    let raf = 0;
    const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
    const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const render = () => {
      resize();
      // One continuous scroll: 0–55% is the hero choreography, 55–100% is
      // "What's inside" — same canvas, same device, no handoff.
      const P = reduce ? 0.18 : progress.current;
      const p = clamp01(P / 0.55);
      const inP = reduce ? 0 : clamp01((P - 0.55) / 0.45);
      const inEntry = easeInOut(clamp01(inP / 0.18));

      // Throughout: slow turntable + power-on glow.
      // As the bird's-eye arrives, the spin settles so the device ends
      // perfectly parallel with the page (portrait, fins up).
      const straighten = easeInOut(clamp01((p - 0.55) / 0.4));
      const spin = -0.5 + p * Math.PI * 2;
      const target = -Math.PI / 2;
      const goal = target + Math.round((spin - target) / (Math.PI * 2)) * Math.PI * 2;
      device.rotation.y = spin + (goal - spin) * straighten + inP * 0.35;
      device.rotation.x = (0.05 + Math.sin(p * Math.PI) * 0.04) * (1 - straighten);
      // On narrow screens the device would span the full width — pull it back.
      device.scale.setScalar(camera.aspect < 0.75 ? 0.78 : camera.aspect < 1.1 ? 0.9 : 1);
      const glow = Math.min(1, p * 1.6);
      rim.intensity = glow * 3.4;

      // 40% → 100%: camera arcs overhead to a bird's-eye view of the internals
      const arc = easeInOut(clamp01((p - 0.4) / 0.6));

      // Sit lower and smaller at rest so the device never crowds the
      // sub-headline (short viewports shrink it further); returns to
      // center/full size as the camera rises.
      device.position.y = -0.24 * (1 - arc) + Math.sin(p * Math.PI) * 0.04;
      const shortness = Math.min(1, canvas.clientHeight / 950);
      const restScale = (1 - 0.08 * (1 - arc)) * (shortness + (1 - shortness) * arc);
      // What's Inside: the same device steps well back so the chip ring has
      // clear air around it (matches the pre-merge scene's proportions).
      device.scale.multiplyScalar(restScale * (1 - 0.45 * inEntry));
      // The ground shadow reads as a detached smear from straight above —
      // fade it out as the chips take the stage.
      groundMat.opacity = 0.16 * (1 - inEntry);

      // 35% → 85%: the lid floats upward off the base, then exits the frame
      const lift = easeInOut(clamp01((p - 0.35) / 0.5));
      if (lid) {
        lid.position.y = LID_CLOSED_Y + lift * (LID_OPEN_Y - LID_CLOSED_Y);
        lid.position.z = arc * LID_DRIFT_Z;
        lid.rotation.x = lift * -0.12; // gentle tilt, like it's being lifted off
        // fade out near the top of the arc so the bird's-eye is internals only
        const fade = clamp01((arc - 0.55) / 0.3);
        lid.visible = fade < 1;
        lidMats.forEach((m) => {
          m.transparent = fade > 0;
          m.opacity = 1 - fade;
        });
      }
      const polar = 1.4 - arc * 1.25; // ~80° → ~9° from vertical
      const radius = 6.3 - arc * 1.1; // dolly in as we rise
      const azim = Math.sin(arc * Math.PI) * 0.25; // drifts out, returns to straight-on
      camera.position.set(
        radius * Math.sin(polar) * Math.sin(azim),
        radius * Math.cos(polar),
        radius * Math.sin(polar) * Math.cos(azim)
      );
      camera.lookAt(0, -0.1, 0);

      if (!reduce) {
        if (headRef.current) headRef.current.style.opacity = String(Math.max(0, 1 - arc * 1.4));
        if (subRef.current) subRef.current.style.opacity = String(Math.max(0, 1 - p * 6));
        if (ebRef.current) ebRef.current.style.opacity = String(Math.max(0, 1 - p * 6));
        if (capRef.current) capRef.current.style.opacity = String(Math.min(1, Math.max(0, (p - 0.6) * 3.2)) * (1 - inEntry));
        if (hintRef.current) hintRef.current.style.opacity = String(Math.max(0, 1 - p * 10));
        if (eyebrowRef.current) eyebrowRef.current.style.opacity = String(inEntry);
        // Hero CTAs/pills step aside once the chips take the stage
        if (ctaGroupRef.current) {
          ctaGroupRef.current.style.opacity = String(1 - inEntry);
          ctaGroupRef.current.style.pointerEvents = inEntry > 0.4 ? "none" : "";
        }
        if (pillsRef.current) pillsRef.current.style.opacity = String(1 - inEntry);
        // Chips launch out of the open chassis (GSAP timeline, scrubbed)
        if (tlRef) {
          tlSmooth += (inP - tlSmooth) * 0.14;
          tlRef.progress(tlSmooth);
        }
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };

    // "What's inside" chip timeline — same pattern as before, now living in
    // the hero's own scroll so the device never changes canvases.
    let tlRef: gsap.core.Timeline | null = null;
    let tlSmooth = 0;
    const stage = stageRef.current;
    const chips = chipRefs.current.filter(Boolean) as HTMLDivElement[];
    const ctx = gsap.context(() => {
      if (reduce || !stage) return;
      const tl = gsap.timeline({ paused: true });
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
          0.12 + i * 0.05
        );
      });
      tl.from(inHeadRef.current, { opacity: 0, y: 26, duration: 0.25, ease: "power2.out" }, 0.92);
      tl.progress(0);
      tlRef = tl;
    }, section);

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", resize);
    onScroll();
    resize();
    render();

    if (import.meta.env.DEV) {
      // Deterministic frame hook for visual auditing (dev only)
      (window as unknown as Record<string, unknown>).__heroSetP = (v: number) => {
        progress.current = v;
      };
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ctx.revert();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", resize);
      scene.environment = null;
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    };
  }, [reduce]);

  return (
    <section ref={sectionRef} className={reduce ? "relative" : "relative h-[520vh]"}>
      <div className="sticky top-0 h-screen overflow-hidden">
        {/* ambient wash */}
        <div className="pointer-events-none absolute inset-0 -z-10 bg-mesh opacity-50" aria-hidden="true" />
        {/* loading shimmer where the device will appear — fades out on model load */}
        <div
          ref={loadingRef}
          className="pointer-events-none absolute left-1/2 top-[62%] -translate-x-1/2 -translate-y-1/2 transition-opacity duration-700"
          aria-hidden="true"
        >
          <div className="h-[34vmin] w-[52vmin] animate-pulse rounded-[2.5rem] bg-[radial-gradient(ellipse,hsl(var(--gradient-end)/0.14),hsl(var(--gradient-start)/0.05)_60%,transparent_75%)]" />
        </div>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          aria-label="A small Bestly server that powers on, rotates, and opens its lid to reveal the internals from above as you scroll"
          role="img"
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center px-6 pt-[7vh] text-center">
          <p ref={ebRef} className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary backdrop-blur-sm">
            Bestly In-House Cloud
          </p>
          <h1 ref={headRef} className="font-modern mt-5 text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            <span className="block">Big tech owns your data.</span>
            <GradientText as="span" className="cloud-underline relative mt-1 inline-block animate-gradient-flow pb-2">
              We think you should.
            </GradientText>
          </h1>
          <p ref={subRef} className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
            One small device in your office replaces thirteen subscriptions — and your data never leaves the building.
          </p>
          {/* CTAs: centered on mobile, pinned to the left side on desktop so the
              device never sits behind them */}
          <div ref={ctaGroupRef} className="pointer-events-auto mt-8 flex flex-col items-center gap-4 sm:flex-row lg:absolute lg:left-[6vw] lg:top-1/2 lg:mt-0 lg:-translate-y-1/2 lg:flex-col lg:items-stretch">
            <Link
              to="/get-started"
              className="group inline-flex items-center justify-center rounded-xl gradient-bg px-8 py-4 text-base font-medium text-white shadow-lg shadow-primary/20 btn-lift glow"
            >
              Get Started
              <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Link>
            <a
              href="#savings"
              className="inline-flex items-center justify-center rounded-xl border border-border bg-background/80 px-8 py-4 text-base font-medium text-foreground shadow-sm backdrop-blur-sm transition-all hover:bg-accent"
            >
              See how much you'll save
            </a>
          </div>
          {/* Trust chips: centered on mobile, pinned right on desktop; pill
              backgrounds keep them readable over the device */}
          <div ref={pillsRef} className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-muted-foreground lg:absolute lg:right-[6vw] lg:top-1/2 lg:mt-0 lg:-translate-y-1/2 lg:flex-col lg:items-end lg:gap-3">
            {["$0 per-seat fees", "Never sold, never retained", "On premises & on brand"].map((t) => (
              <span
                key={t}
                className="flex items-center gap-2 rounded-full border border-border bg-background/75 px-4 py-2 text-foreground shadow-sm backdrop-blur-sm"
              >
                <CheckCircle2 className="h-4 w-4 text-primary" />
                {t}
              </span>
            ))}
          </div>
          <p ref={capRef} className="absolute bottom-[8vh] left-1/2 -translate-x-1/2 text-sm text-muted-foreground" style={{ opacity: 0 }}>
            Look inside. <span className="font-medium text-foreground">Thirteen services, one small device.</span>
          </p>
          {/* ── What's Inside (phase 2 of the same continuous scroll) ── */}
          <p
            ref={eyebrowRef}
            className="absolute top-[7vh] left-1/2 -translate-x-1/2 text-sm font-semibold uppercase tracking-widest text-primary"
            style={{ opacity: 0 }}
          >
            What's inside
          </p>
          <div
            ref={stageRef}
            className="pointer-events-none absolute left-1/2 top-[53%] aspect-square w-full -translate-x-1/2 -translate-y-1/2"
            style={{ maxWidth: "min(94vw, 780px, 82vh)" }}
            aria-hidden="true"
          >
            {SERVICES.map((s, i) => {
              const ang = (2 * Math.PI / SERVICES.length) * i - Math.PI / 2;
              const x = 50 + 45 * Math.cos(ang);
              const y = 50 + 45 * Math.sin(ang);
              return (
                <div
                  key={s.title}
                  ref={(el) => (chipRefs.current[i] = el)}
                  className="absolute flex w-[108px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 text-center will-change-transform"
                  style={{ left: `${x}%`, top: `${y}%` }}
                >
                  <div className="flex h-[58px] w-[58px] items-center justify-center rounded-[16px] border border-border bg-card/90 shadow-premium backdrop-blur-sm">
                    <s.icon className="h-[26px] w-[26px] text-primary" />
                  </div>
                  <span className="rounded-full bg-background/70 px-2.5 py-0.5 text-xs font-semibold leading-tight text-foreground backdrop-blur-sm">
                    {s.title}
                  </span>
                </div>
              );
            })}
          </div>
          <div ref={inHeadRef} className="absolute bottom-[7vh] left-1/2 w-full -translate-x-1/2 px-6 text-center">
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Thirteen services.{" "}
              <GradientText as="span" className="animate-gradient-flow">Out of one small box.</GradientText>
            </h2>
          </div>
          {!reduce && (
            <div
              ref={hintRef}
              className="absolute bottom-[3vh] left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 text-xs font-medium uppercase tracking-widest text-muted-foreground"
              aria-hidden="true"
            >
              Scroll
              <ChevronDown className="h-4 w-4 animate-bounce motion-reduce:animate-none" />
            </div>
          )}
        </div>
        {/* fade into next section */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-background" aria-hidden="true" />
      </div>
    </section>
  );
}
