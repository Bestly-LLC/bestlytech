import { useRef } from "react";
import { Link } from "react-router-dom";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { GradientText } from "@/components/ui/GradientText";
import { ServiceOrbit } from "@/components/cloud/ServiceOrbit";

/* Deterministic light-motes so the field is stable across renders. */
const MOTES = [
  { left: "8%", top: "22%", size: 4, delay: "0s" },
  { left: "18%", top: "68%", size: 3, delay: "1.2s" },
  { left: "30%", top: "12%", size: 5, delay: "0.6s" },
  { left: "44%", top: "80%", size: 3, delay: "2.1s" },
  { left: "58%", top: "30%", size: 4, delay: "1.7s" },
  { left: "70%", top: "74%", size: 5, delay: "0.3s" },
  { left: "82%", top: "20%", size: 3, delay: "2.6s" },
  { left: "90%", top: "58%", size: 4, delay: "1.0s" },
  { left: "12%", top: "44%", size: 3, delay: "3.0s" },
  { left: "64%", top: "54%", size: 3, delay: "2.3s" },
];

const ease = [0.25, 0.1, 0.25, 1] as const;

export function CloudHeroSpectacle() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  // Parallax: copy drifts up gently, orbit sinks — disabled under reduced-motion.
  const yCopy = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -60]);
  const yOrbit = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 80]);
  const orbitOpacity = useTransform(scrollYProgress, [0, 0.8], [1, reduce ? 1 : 0.3]);

  return (
    <section ref={ref} className="relative overflow-hidden">
      {/* ── Animated background stack ───────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        {/* base mesh */}
        <div className="absolute inset-0 bg-mesh opacity-60" />
        {/* drifting aurora blobs */}
        <div className="absolute -left-32 top-0 h-[36rem] w-[36rem] rounded-full bg-[radial-gradient(circle,hsl(var(--gradient-start)/0.28),transparent_70%)] blur-2xl cloud-aurora-a" />
        <div className="absolute -right-24 top-10 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,hsl(var(--gradient-end)/0.26),transparent_70%)] blur-2xl cloud-aurora-b" />
        <div className="absolute bottom-[-12rem] left-1/3 h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle,hsl(var(--glow-color)/0.2),transparent_70%)] blur-2xl cloud-aurora-c" />
        {/* perspective infrastructure grid along the floor */}
        <div className="absolute inset-x-0 bottom-0 h-1/2 [perspective:600px]">
          <div className="absolute inset-0 origin-bottom [transform:rotateX(72deg)]">
            <div className="cloud-grid absolute inset-0" />
          </div>
        </div>
        {/* twinkling motes */}
        {MOTES.map((m, i) => (
          <span
            key={i}
            className="cloud-mote absolute rounded-full bg-[hsl(var(--glow-color))]"
            style={{ left: m.left, top: m.top, width: m.size, height: m.size, animationDelay: m.delay }}
          />
        ))}
      </div>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <div className="relative mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-28">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          {/* Copy */}
          <motion.div style={{ y: yCopy }} className="text-center lg:text-left">
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease }}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary backdrop-blur-sm"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              Flagship Program · Bestly In-House Cloud
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.7, ease, delay: 0.08 }}
              className="mt-6 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl"
            >
              Big tech owns your data.{" "}
              <GradientText as="span" className="animate-gradient-flow whitespace-nowrap inline-block">
                We think you should.
              </GradientText>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease, delay: 0.18 }}
              className="mx-auto mt-6 max-w-2xl text-xl leading-relaxed text-muted-foreground lg:mx-0"
            >
              A private cloud that lives in your office, wears your logo, and ends per-seat
              licensing for good. For teams of 5 to 200+.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease, delay: 0.28 }}
              className="mt-10 flex flex-col items-center gap-4 sm:flex-row lg:justify-start sm:justify-center"
            >
              <Link
                to="/get-started"
                className="group inline-flex items-center justify-center rounded-xl gradient-bg px-8 py-4 text-base font-medium text-white shadow-lg shadow-primary/20 btn-lift glow"
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
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, ease, delay: 0.4 }}
              className="mt-10 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground lg:justify-start"
            >
              {["$0 per-seat fees", "On premises & on brand", "5–200+ user teams"].map((t) => (
                <div key={t} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>{t}</span>
                </div>
              ))}
            </motion.div>
          </motion.div>

          {/* Orbit */}
          <motion.div
            style={{ y: yOrbit, opacity: orbitOpacity }}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.9, ease, delay: 0.2 }}
            className="relative"
          >
            <ServiceOrbit />
            <p className="mt-10 text-center text-sm font-medium text-muted-foreground lg:mt-6">
              Thirteen services. <span className="text-foreground">One server on your shelf.</span>
            </p>
          </motion.div>
        </div>
      </div>

      {/* Soft fade into the next section */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-background" aria-hidden="true" />
    </section>
  );
}
