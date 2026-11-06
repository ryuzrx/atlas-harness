import React, { useEffect, useState } from "react";
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
  const ready = useAfterSplash(afterSplash);
  useEffect(() => {
    if (!ready || play !== "assemble" || !onDone) return;
    const ms = matchMedia("(prefers-reduced-motion: reduce)").matches ? 200 : variant === "cinematic" ? 1150 : 620;
    const t = window.setTimeout(onDone, ms);
    return () => window.clearTimeout(t);
  }, [ready, play, variant]);

  if (play === "shimmer") {
    return <svg width={size} height={(size * 28) / 40} viewBox="0 0 40 28" fill="currentColor" aria-hidden className={cx("am-shimmer", className)}>
      <path className="am-thinking-left" d={LEFT} /><path className="am-thinking-right" d={RIGHT} />
    </svg>;
  }

  return (
    <svg width={size} height={(size * 28) / 40} viewBox="0 0 40 28" fill="currentColor" aria-hidden
      className={cx("overflow-visible", play === "assemble" && ready && `am-play am-${variant}`, play === "assemble" && !ready && "opacity-0", className)}>
      <g className="am-left"><path d={LEFT} /></g>
      <g className="am-right"><path d={RIGHT} /></g>
    </svg>
  );
}
