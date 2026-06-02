import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import * as THREE from "three";
import { GradientText } from "@/components/ui/GradientText";

/**
 * CloudScrollHero — Apple-style scroll-scrubbed product hero (Phase 1).
 *
 * A live WebGL render of the Bestly "small device" that powers on (indigo
 * accent + rim glow) and turns a full rotation as you scroll through a pinned
 * section. No render pipeline, no image sequence — the rotation maps 1:1 to
 * scroll. Under prefers-reduced-motion it collapses to a single static frame.
 *
 * Production note: the live model can later be swapped for a photoreal Blender
 * turntable + AR per docs/cloud-apple-grade-opusplan.md without touching the
 * surrounding copy/CTA layout.
 */
export function CloudScrollHero() {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const subRef = useRef<HTMLParagraphElement>(null);
  const ebRef = useRef<HTMLParagraphElement>(null);
  const capRef = useRef<HTMLParagraphElement>(null);
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

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ opacity: 0.16 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.92;
    ground.receiveShadow = true;
    scene.add(ground);

    const disposables: Array<{ dispose: () => void }> = [];
    const roundedBox = (w: number, h: number, d: number, r: number) => {
      const s = new THREE.Shape();
      const x = -w / 2, y = -h / 2;
      s.moveTo(x + r, y);
      s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
      s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
      s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
      const g = new THREE.ExtrudeGeometry(s, {
        depth: d, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 6, steps: 1,
      });
      g.center();
      disposables.push(g);
      return g;
    };

    const device = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.42, metalness: 0.35 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0x222530, roughness: 0.28, metalness: 0.65 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x7a8be0, emissive: 0x7a8be0, emissiveIntensity: 0.2, roughness: 0.4 });
    const dotMat = new THREE.MeshStandardMaterial({ color: 0x9fb0ff, emissive: 0x9fb0ff, emissiveIntensity: 0.3 });
    disposables.push(bodyMat, topMat, accentMat, dotMat);

    const body = new THREE.Mesh(roundedBox(2.7, 1.35, 1.5, 0.2), bodyMat);
    body.castShadow = true;
    device.add(body);
    const top = new THREE.Mesh(roundedBox(2.3, 0.06, 1.18, 0.1), topMat);
    top.position.y = 0.7;
    device.add(top);
    const accentGeo = new THREE.BoxGeometry(1.8, 0.07, 0.05);
    disposables.push(accentGeo);
    const accent = new THREE.Mesh(accentGeo, accentMat);
    accent.position.set(0, -0.28, 0.79);
    device.add(accent);
    const dotGeo = new THREE.CircleGeometry(0.045, 24);
    disposables.push(dotGeo);
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.set(1.02, 0.24, 0.79);
    device.add(dot);
    device.rotation.set(0.05, -0.5, 0);
    scene.add(device);

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
    const render = () => {
      resize();
      const p = reduce ? 0.32 : progress.current;
      device.rotation.y = -0.5 + p * Math.PI * 2;
      device.rotation.x = 0.05 + Math.sin(p * Math.PI) * 0.06;
      device.position.y = Math.sin(p * Math.PI) * 0.05;
      const glow = Math.min(1, p * 1.6);
      accentMat.emissiveIntensity = 0.2 + glow * 2.4;
      dotMat.emissiveIntensity = 0.3 + glow * 1.6;
      rim.intensity = glow * 3.4;
      camera.position.z = 6.2 - p * 0.8;
      if (!reduce) {
        if (subRef.current) subRef.current.style.opacity = String(Math.max(0, 1 - p * 1.8));
        if (ebRef.current) ebRef.current.style.opacity = String(Math.max(0, 1 - p * 2.5));
        if (capRef.current) capRef.current.style.opacity = String(Math.min(1, Math.max(0, (p - 0.45) * 3)));
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", resize);
    onScroll();
    resize();
    render();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", resize);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    };
  }, [reduce]);

  return (
    <section ref={sectionRef} className={reduce ? "relative" : "relative h-[300vh]"}>
      <div className="sticky top-0 h-screen overflow-hidden">
        {/* ambient wash */}
        <div className="pointer-events-none absolute inset-0 -z-10 bg-mesh opacity-50" aria-hidden="true" />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          aria-label="A small Bestly server that powers on and rotates as you scroll"
          role="img"
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center px-6 pt-[7vh] text-center">
          <p ref={ebRef} className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary backdrop-blur-sm">
            Bestly In-House Cloud
          </p>
          <h1 className="font-modern mt-5 max-w-[16ch] text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Big tech owns your data.{" "}
            <GradientText as="span" className="animate-gradient-flow">We think you should.</GradientText>
          </h1>
          <p ref={subRef} className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
            One small device in your office replaces thirteen subscriptions — and your data never leaves the building.
          </p>
          <div className="pointer-events-auto mt-8 flex flex-col items-center gap-4 sm:flex-row">
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
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {["$0 per-seat fees", "Never sold, never retained", "On premises & on brand"].map((t) => (
              <span key={t} className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                {t}
              </span>
            ))}
          </div>
          <p ref={capRef} className="absolute bottom-[8vh] left-1/2 -translate-x-1/2 text-sm text-muted-foreground" style={{ opacity: 0 }}>
            Thirteen services. <span className="font-medium text-foreground">One small device.</span>
          </p>
        </div>
        {/* fade into next section */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-background" aria-hidden="true" />
      </div>
    </section>
  );
}
