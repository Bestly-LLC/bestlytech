import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GradientText } from "@/components/ui/GradientText";
import { loadDeviceGLTF } from "./deviceModel";

/**
 * CloudDockCTA — final scene of the /cloud 3D story.
 *
 * The device descends and docks onto its shelf, the glow ignites, and the
 * closing CTA lands. Last frame of the narrative: it's real, it's small,
 * it sits in your office. Manual scrub + sticky stage (no ScrollTrigger
 * pin — transformed ancestors break it).
 */

export function CloudDockCTA() {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const canvas = canvasRef.current;
    if (!section || !canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 100);
    camera.position.set(0, 1.7, 4.9);
    camera.lookAt(0, -0.15, 0);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe3ee, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(3, 7, 5);
    scene.add(key);
    const rim = new THREE.PointLight(0x7a8be0, 0, 14);
    rim.position.set(-2.5, 1.2, -3);
    scene.add(rim);

    const device = new THREE.Group();
    device.rotation.set(0.05, -0.5, 0);
    scene.add(device);

    const disposables: Array<{ dispose: () => void }> = [{ dispose: () => pmrem.dispose() }, envTex];
    let cancelled = false;
    loadDeviceGLTF().then((gltf) => {
      if (cancelled) return;
      const model = gltf.scene.clone(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      model.scale.setScalar(2.15 / Math.max(size.x, size.y, size.z));
      box.setFromObject(model);
      model.position.sub(box.getCenter(new THREE.Vector3()));
      const lid = model.getObjectByName("lid");
      if (lid) lid.position.y = -0.125; // sealed
      if (import.meta.env.DEV) {
        (window as unknown as Record<string, unknown>).__dockInfo = {
          lidFound: !!lid,
          lidY: lid?.position.y,
          children: model.children.map((c) => c.name),
        };
      }
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
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    let target = 0;
    let smooth = reduce ? 1 : 0;
    const onScroll = () => {
      const total = section.offsetHeight - window.innerHeight;
      target = total > 0 ? clamp01(-section.getBoundingClientRect().top / total) : 0;
    };

    let raf = 0;
    let running = false;
    const apply = (p: number) => {
      // short, grounded descent — lands by 45%, no long float
      const drop = easeOutCubic(clamp01(p / 0.45));
      device.position.y = (1 - drop) * 0.38 - 0.22;
      device.rotation.y = -0.5 + drop * 0.24;
      device.rotation.x = 0.05 + (1 - drop) * 0.06;
      // glow ignites on touchdown
      const ignite = clamp01((p - 0.42) / 0.18);
      rim.intensity = ignite * 3.2;
      if (shadowRef.current) {
        shadowRef.current.style.opacity = String(0.3 + drop * 0.4);
        shadowRef.current.style.transform = `translateX(-50%) scaleX(${0.7 + drop * 0.3})`;
      }
      if (copyRef.current) {
        const reveal = clamp01((p - 0.32) / 0.3);
        copyRef.current.style.opacity = String(reveal);
        copyRef.current.style.transform = `translateY(${(1 - reveal) * 26}px)`;
      }
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
      (window as unknown as Record<string, unknown>).__dockSetP = (v: number) => {
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
      className={`relative overflow-hidden border-t border-border ${reduce ? "" : "h-[160vh]"}`}
      aria-label="The device docks on your shelf — get started"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute inset-0 bg-mesh opacity-50" />
        <div className="absolute -left-20 top-0 h-80 w-80 rounded-full bg-[radial-gradient(circle,hsl(var(--gradient-start)/0.22),transparent_70%)] blur-2xl cloud-aurora-a" />
        <div className="absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-[radial-gradient(circle,hsl(var(--gradient-end)/0.22),transparent_70%)] blur-2xl cloud-aurora-b" />
      </div>
      <div className="sticky top-0 flex h-screen flex-col items-center justify-center overflow-hidden px-6">
        <div className="relative aspect-[4/3] w-full" style={{ maxWidth: "min(86vw, 560px, 52vh)" }}>
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
          {/* the shelf: a real surface to land on, not empty space */}
          <div
            className="pointer-events-none absolute bottom-[8%] left-1/2 h-px w-[92%] -translate-x-1/2 bg-gradient-to-r from-transparent via-border to-transparent"
            aria-hidden="true"
          />
          <div
            ref={shadowRef}
            className="pointer-events-none absolute bottom-[6%] left-1/2 h-[5%] w-[64%] rounded-[50%] bg-[radial-gradient(ellipse,hsl(222_20%_20%/0.5),transparent_70%)]"
            style={{ opacity: 0.3, transform: "translateX(-50%) scaleX(0.7)" }}
            aria-hidden="true"
          />
        </div>
        <div ref={copyRef} className="relative z-10 mt-2 max-w-3xl text-center" style={reduce ? undefined : { opacity: 0 }}>
          <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Stop renting. <GradientText as="span">Start owning.</GradientText>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Thirty minutes on a call, a side-by-side cost comparison, and zero
            pressure. Bring your stack home — on hardware you own, with data we
            never sell or retain.
          </p>
          <div className="pointer-events-auto mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              to="/get-started"
              className="group inline-flex items-center justify-center rounded-xl gradient-bg px-8 py-4 text-base font-medium text-white shadow-lg shadow-primary/20 btn-lift"
            >
              Get Started
              <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Link>
            <a
              href="mailto:jared@bestly.tech?subject=In-House%20Cloud%20Discovery%20Call"
              className="inline-flex items-center justify-center rounded-xl border border-border bg-background/80 px-8 py-4 text-base font-medium text-foreground shadow-sm backdrop-blur-sm transition-all hover:bg-accent"
            >
              Email jared@bestly.tech
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
