import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AtlasMark } from "./Logo";
import { cx } from "./ui";
import { useStore } from "../store";
import { setSplashActive } from "./AnimatedMark";

/** Launch waits for the workspace, with a bounded wait and an explicit skip action. */
export function Splash({ onFinish, ready = true }: { onFinish: () => void; ready?: boolean }) {
  const dialog = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { dialog.current?.focus(); }, []);
  const { settings } = useStore();
  const displayName = settings?.["profile.personalized_greeting"] !== false ? String(settings?.["profile.name"] || "").trim() : "";
  const [first] = useState(() => !localStorage.getItem("atlas_welcome_seen"));
  const [phase, setPhase] = useState<"enter" | "leave">("enter");
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [expired, setExpired] = useState(false);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const greeting = displayName ? [first ? "Welcome," : "Welcome back,", displayName] : first ? ["Welcome", "to", "Atlas"] : ["Atlas"];
  const leave = () => setPhase("leave");
  useEffect(() => {
    setSplashActive(true);
    const maximum = window.setTimeout(() => setExpired(true), 8000);
    return () => { clearTimeout(maximum); setSplashActive(false); };
  }, []);
  useEffect(() => {
    setMinimumElapsed(false);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("reduce-motion");
    const timer = window.setTimeout(() => setMinimumElapsed(true), reduced ? 0 : 2100);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (phase !== "leave") return;
    localStorage.setItem("atlas_welcome_seen", "1");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("reduce-motion");
    const timer = window.setTimeout(() => { setSplashActive(false); onFinishRef.current(); }, reduced ? 0 : 620);
    return () => clearTimeout(timer);
  }, [phase]);
  useEffect(() => {
    if ((ready && settings?.["general.launch_animation"] === false) || (minimumElapsed && (ready || expired))) leave();
  }, [minimumElapsed, ready, expired, settings?.["general.launch_animation"]]);
  useEffect(() => {
    const skip = (event: KeyboardEvent) => { if (event.key === "Escape") leave(); };
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
  }, []);
  return <div ref={dialog} tabIndex={-1} onKeyDown={(event) => {
    if (event.key !== "Tab") return;
    const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || []);
    if (!controls.length) { event.preventDefault(); return; }
    const firstControl = controls[0], lastControl = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === firstControl || document.activeElement === dialog.current)) { event.preventDefault(); lastControl.focus(); }
    else if (!event.shiftKey && document.activeElement === lastControl) { event.preventDefault(); firstControl.focus(); }
  }} role="status" aria-label="Starting Atlas"
    className={cx("atlas-launch fixed inset-0 z-[90] flex flex-col items-center justify-center bg-[var(--base)] text-ink", phase === "leave" && "atlas-launch-leave")}>
    <div className="drag absolute top-0 inset-x-0 h-[52px]" />
    <div className="atlas-launch-content flex flex-col items-center px-6 text-center">
      <div className="atlas-launch-emblem" aria-hidden="true">
        <div className="atlas-launch-orbits"><svg viewBox="0 0 200 200" fill="none"><circle className="atlas-orbit-outer" cx="100" cy="100" r="89" /><circle className="atlas-orbit-inner" cx="100" cy="100" r="72" /></svg></div>
        <span className="atlas-launch-ripple" />
        <div className="atlas-launch-float"><div className="atlas-launch-mark flex items-center justify-center"><AtlasMark size={48} /><span className="atlas-launch-sheen" /></div></div>
      </div>
      <h1 aria-label={greeting.join(" ")} className="atlas-launch-title mt-7 text-[clamp(28px,4vw,38px)] leading-[1.2] font-semibold tracking-[-0.04em]">
        {greeting.map((word, index) => <span key={word} className="atlas-title-mask" aria-hidden="true"><span style={{ animationDelay: `${920 + index * 110}ms` }}>{word}</span>{index < greeting.length - 1 ? "\u00a0" : ""}</span>)}
      </h1>
      <p role="status" className="atlas-launch-subtitle mt-2 text-sm text-ink-2">{first && ready ? "Your workspace is ready." : "Preparing your workspace"}</p>
      {!ready && <div className="atlas-loading-track mt-7" aria-hidden="true"><span /></div>}
    </div>
    <button onClick={leave} className="absolute bottom-7 px-3 py-2 rounded-lg text-xs text-ink-3 hover:text-ink hover:bg-hover">Skip intro</button>
  </div>;
}

/** Page loading uses stable placeholders instead of a lone spinning icon. */
export function ViewLoading() {
  return <div className="atlas-view-loading mx-auto max-w-[1060px] py-2" role="status" aria-label="Loading page">
    <span className="sr-only">Loading page…</span>
    <div aria-hidden="true" className="space-y-6">
      <div className="space-y-3"><div className="atlas-skeleton h-7 w-40" /><div className="atlas-skeleton h-3 w-64 max-w-full" /></div>
      <div className="atlas-skeleton h-10 w-full" />
      <div className="grid grid-cols-1 min-[900px]:grid-cols-2 gap-4"><div className="atlas-skeleton h-40" /><div className="atlas-skeleton h-40" /></div>
    </div>
  </div>;
}
