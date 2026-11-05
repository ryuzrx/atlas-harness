import React, { useEffect, useId, useState } from "react";
import { cx } from "./ui";

/*
 * Animated Atlas monogram.
 *
 *  assemble  – the two strokes slide in from opposite sides and snap together with a small spring settle.
 *              "quick" ≈ 0.6 s for every launch; "cinematic" ≈ 1.5 s (longer travel, stagger, then the
 *              wordmark rises in) for the very first launch.
 *  shimmer   – a soft highlight travels across the strokes on a loop while the AI is thinking.
 *
 * Motion rules (apple-design): only transform/opacity animate, motion starts where the strokes come from,
 * the overshoot is small and only on arrival, and prefers-reduced-motion gets a plain cross-fade / static mark.
 */

const LEFT = "M0 28 L13 0 H21 L8 28 Z";
const RIGHT = "M23.6 5.2 L39 28 H29.6 L19.9 13.2 Z";

// ---- splash coordination: marks that should play "after the splash" wait for it to finish
let splashActive = false;
const waiters = new Set<() => void>();
export function setSplashActive(v: boolean) {
  splashActive = v;
  if (!v) { waiters.forEach((f) => f()); waiters.clear(); }
}
function useAfterSplash(enabled: boolean) {
  const [ready, setReady] = useState(!enabled || !splashActive);
  useEffect(() => {
    if (ready) return;
    const f = () => setReady(true);
    waiters.add(f);
    return () => { waiters.delete(f); };
  }, [ready]);
  return ready;
}

export function AnimatedMark({ size = 64, play = "assemble", variant = "quick", afterSplash = false, className, onDone }: {
  size?: number; play?: "assemble" | "shimmer" | "static"; variant?: "quick" | "cinematic";
  afterSplash?: boolean; className?: string; onDone?: () => void;
}) {
  const id = useId().replace(/:/g, "");
  const ready = useAfterSplash(afterSplash);
  useEffect(() => {
    if (!ready || play !== "assemble" || !onDone) return;
    const ms = matchMedia("(prefers-reduced-motion: reduce)").matches ? 200 : variant === "cinematic" ? 1150 : 620;
    const t = window.setTimeout(onDone, ms);
    return () => window.clearTimeout(t);
  }, [ready, play, variant]);

  if (play === "shimmer") {
    return (
      <svg width={size} height={(size * 28) / 40} viewBox="0 0 40 28" aria-hidden className={cx("am-shimmer", className)}>
        <defs>
          <linearGradient id={`g${id}`} gradientUnits="userSpaceOnUse" x1="-30" y1="0" x2="0" y2="0">
            <stop offset="0" stopColor="var(--text-3)" />
            <stop offset="0.5" stopColor="var(--text)" />
            <stop offset="1" stopColor="var(--text-3)" />
            {/* the highlight band travels from left of the mark to past its right edge */}
            <animate attributeName="x1" values="-30;40" dur="1.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1" />
            <animate attributeName="x2" values="0;70" dur="1.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1" />
          </linearGradient>
        </defs>
        <path d={LEFT} fill={`url(#g${id})`} />
        <path d={RIGHT} fill={`url(#g${id})`} />
      </svg>
    );
  }

  return (
    <svg width={size} height={(size * 28) / 40} viewBox="0 0 40 28" fill="currentColor" aria-hidden
      className={cx("overflow-visible", play === "assemble" && ready && `am-play am-${variant}`, play === "assemble" && !ready && "opacity-0", className)}>
      <g className="am-left"><path d={LEFT} /></g>
      <g className="am-right"><path d={RIGHT} /></g>
    </svg>
  );
}

/** Launch splash: plays the assemble animation, holds briefly, then fades away. Click or any key skips it. */
export function Splash({ onFinish }: { onFinish: () => void }) {
  const first = !localStorage.getItem("atlas_intro_seen");
  const variant = first ? "cinematic" : "quick";
  const [phase, setPhase] = useState<"in" | "out">("in");
  useEffect(() => { setSplashActive(true); }, []);
  const leave = () => {
    if (phase === "out") return;
    setPhase("out");
    localStorage.setItem("atlas_intro_seen", "1");
    window.setTimeout(() => { setSplashActive(false); onFinish(); }, first ? 320 : 220);
  };
  useEffect(() => {
    const k = () => leave();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  return (
    <div onMouseDown={leave} role="presentation"
      className={cx("fixed inset-0 z-[90] bg-[var(--base)] flex flex-col items-center justify-center transition-opacity ease-[var(--ease)]",
        first ? "duration-300" : "duration-200", phase === "out" && "opacity-0 pointer-events-none")}>
      <div className="drag absolute top-0 inset-x-0 h-[52px]" />
      <div className={cx("text-ink flex flex-col items-center", phase === "out" && "am-exit")}>
        <AnimatedMark size={first ? 112 : 88} play="assemble" variant={variant}
          onDone={() => window.setTimeout(leave, first ? 420 : 160)} />
        {first && (
          <div className="am-word mt-6 flex flex-col items-center">
            <span className="text-[30px] font-semibold tracking-[-0.01em] text-ink leading-none">Atlas</span>
            <span className="text-xs tracking-[0.32em] text-ink-2 mt-2 pl-[0.32em]">HARNESS</span>
          </div>
        )}
      </div>
    </div>
  );
}
