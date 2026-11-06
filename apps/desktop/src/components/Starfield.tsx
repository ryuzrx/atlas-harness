import React, { useEffect, useRef } from "react";

/**
 * Quiet, twinkling starfield for empty states. Dark theme only (CSS hides it in light),
 * pauses when hidden, and renders a still frame when motion is reduced.
 */
export function Starfield({ density = 2600 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("reduce-motion");
    let w = 0, h = 0, raf = 0, stars: { x: number; y: number; r: number; a: number; s: number; o: number }[] = [];
    const build = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      w = rect.width; h = rect.height;
      canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round((w * h) / density);
      stars = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h, r: 0.35 + Math.random() ** 2 * 1.25,
        a: 0.35 + Math.random() * 0.6, s: 0.3 + Math.random() * 1.2, o: Math.random() * 6.28,
      }));
    };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#fff";
      const calm = still();
      for (const s of stars) {
        ctx.globalAlpha = s.a * (calm ? 1 : 0.65 + 0.35 * Math.sin((t / 1000) * s.s + s.o));
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    const loop = (t: number) => { draw(t); raf = requestAnimationFrame(loop); };
    const start = () => { cancelAnimationFrame(raf); if (still()) draw(0); else raf = requestAnimationFrame(loop); };
    build(); start();
    const ro = new ResizeObserver(() => { build(); if (still()) draw(0); });
    ro.observe(canvas);
    const vis = () => { if (document.hidden) cancelAnimationFrame(raf); else start(); };
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", vis); };
  }, [density]);
  return <canvas ref={ref} aria-hidden="true" className="starfield pointer-events-none absolute inset-0 h-full w-full" />;
}
