const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// mobile nav
const navToggle = document.querySelector(".menu-toggle");
const mainNav = document.querySelector("#main-nav");
const setNav = (open) => {
  navToggle?.setAttribute("aria-expanded", String(open));
  navToggle?.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  mainNav?.classList.toggle("is-open", open);
};
navToggle?.addEventListener("click", () => setNav(navToggle.getAttribute("aria-expanded") !== "true"));
mainNav?.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setNav(false)));

// header gains a hairline only once content scrolls beneath it
const header = document.querySelector(".site-header");
const onScroll = () => header?.classList.toggle("is-scrolled", scrollY > 8);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

// logo intro: plays once per session, then the page reveals behind it
const introEl = document.querySelector("#intro");
const introOn = document.documentElement.classList.contains("intro-on");
const endIntro = () => {
  if (!introEl || introEl.classList.contains("is-leaving")) return;
  const svg = introEl.querySelector(".intro-mark svg");
  const target = document.querySelector(".brand img");
  introEl.classList.add("is-leaving");
  // shared-element move: the mark travels to where the header logo sits
  if (svg && target) {
    const from = svg.getBoundingClientRect(), to = target.getBoundingClientRect();
    const scale = to.width / from.width;
    svg.style.transform = `translate(${to.left + to.width / 2 - (from.left + from.width / 2)}px, ${to.top + to.height / 2 - (from.top + from.height / 2)}px) scale(${scale})`;
  }
  setTimeout(() => {
    document.documentElement.classList.remove("intro-on");   // header logo takes over exactly where the mark landed
    introEl.classList.add("is-done");
    try { sessionStorage.setItem("atlas_intro", "1"); } catch {}
  }, 1000);
  setTimeout(startReveals, 450);
};
if (introOn) setTimeout(endIntro, 1900); else queueMicrotask(() => startReveals());

// hero window flattens as it scrolls into place
const heroWindow = document.querySelector(".hero .app-window");
const tilt = () => {
  if (!heroWindow) return;
  const r = heroWindow.getBoundingClientRect();
  const p = Math.min(1, Math.max(0, 1 - (r.top - innerHeight * 0.18) / (innerHeight * 0.6)));
  heroWindow.style.setProperty("--p", p.toFixed(3));
};
if (!reduceMotion) { addEventListener("scroll", tilt, { passive: true }); addEventListener("resize", tilt); tilt(); }

// scroll reveals
// split the headline into words (keeps <br> and the muted <span>)
const h1 = document.querySelector(".hero h1");
if (h1) {
  let i = 0;
  const wrap = (node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.append(part); return; }
          const w = document.createElement("span");
          w.className = "w"; w.style.setProperty("--i", i++); w.textContent = part;
          frag.append(w);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && n.tagName !== "BR") wrap(n);
    });
  };
  wrap(h1);
}

function startReveals() {
  h1?.classList.add("is-in");
const targets = document.querySelectorAll(".hero-copy > :not(h1), .hero-visual, .intro-inner > *, .feature-copy, .feature-image, .privacy-heading, .privacy-detail, .privacy-basics > div, .faq-heading, .faq-list details, .closing-section, .story-copy > .eyebrow, .story-copy > h2");
targets.forEach((el, i) => { el.setAttribute("data-reveal", ""); el.style.setProperty("--d", `${(i % 4) * 70}ms`); });
if (reduceMotion || !("IntersectionObserver" in window)) {
  targets.forEach((el) => el.classList.add("is-in"));
} else {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
  }), { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  targets.forEach((el) => io.observe(el));
}

}

// scroll-driven story: the app window stays put and its screen follows your scroll
const story = document.querySelector("[data-story]");
if (story) {
  const steps = [...story.querySelectorAll(".story-step")];
  const shots = [...story.querySelectorAll(".shot-stack img")];
  const track = story.querySelector(".story-track");
  let current = -1;
  const update = () => {
    if (matchMedia("(max-width: 900px)").matches) return;
    const r = track.getBoundingClientRect();
    const range = r.height - innerHeight;
    const p = Math.min(0.999, Math.max(0, -r.top / Math.max(1, range)));
    const idx = Math.floor(p * steps.length);
    if (idx === current) return;
    current = idx;
    steps.forEach((s, i) => s.classList.toggle("is-active", i === idx));
    shots.forEach((s, i) => s.classList.toggle("is-active", i === idx));
  };
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  update();
}

// space: layered, twinkling starfield with scroll parallax and an occasional shooting star
(() => {
  const canvas = document.querySelector("#space");
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  const LAYERS = [{ n: 1, r: [0.3, 0.7], a: [0.25, 0.55], p: 0.04 }, { n: 0.5, r: [0.5, 1.0], a: [0.4, 0.8], p: 0.09 }, { n: 0.2, r: [0.8, 1.6], a: [0.6, 1], p: 0.16 }];
  let w = 0, h = 0, dpr = 1, stars = [], shooter = null, nextShot = 0, mx = 0, my = 0, raf = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const build = () => {
    dpr = Math.min(2, devicePixelRatio || 1);
    w = innerWidth; h = innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const total = Math.round((w * h) / 2300);
    stars = LAYERS.flatMap((L, li) => Array.from({ length: Math.round(total * L.n / 1.7) }, () => ({
      x: Math.random() * w, y: Math.random() * h, r: rnd(...L.r), a: rnd(...L.a), p: L.p, li,
      s: rnd(0.4, 1.6), o: Math.random() * 6.28, warm: Math.random() < 0.12,
    })));
  };
  const draw = (t) => {
    ctx.clearRect(0, 0, w, h);
    const sy = scrollY;
    for (const s of stars) {
      const tw = reduceMotion ? 1 : 0.7 + 0.3 * Math.sin(t / 1000 * s.s + s.o);
      let y = (s.y - sy * s.p + my * s.p * 6) % h; if (y < 0) y += h;
      let x = (s.x + mx * s.p * 6) % w; if (x < 0) x += w;
      ctx.globalAlpha = s.a * tw;
      ctx.fillStyle = s.warm ? "#ffe9d2" : "#fff";
      ctx.beginPath(); ctx.arc(x, y, s.r, 0, 6.2832); ctx.fill();
    }
    if (!reduceMotion) {
      if (!shooter && t > nextShot) {
        const ang = rnd(0.35, 0.65);
        shooter = { x: rnd(w * 0.25, w), y: rnd(0, h * 0.35), vx: -Math.cos(ang) * 900, vy: Math.sin(ang) * 900, life: 0 };
        nextShot = t + rnd(7000, 14000);
      }
      if (shooter) {
        shooter.life += 1 / 60;
        shooter.x += shooter.vx / 60; shooter.y += shooter.vy / 60;
        const k = Math.max(0, 1 - shooter.life / 0.9);
        const g = ctx.createLinearGradient(shooter.x, shooter.y, shooter.x - shooter.vx * 0.12, shooter.y - shooter.vy * 0.12);
        g.addColorStop(0, `rgba(255,255,255,${0.85 * k})`); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.globalAlpha = 1; ctx.strokeStyle = g; ctx.lineWidth = 1.2; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(shooter.x, shooter.y); ctx.lineTo(shooter.x - shooter.vx * 0.12, shooter.y - shooter.vy * 0.12); ctx.stroke();
        if (k <= 0) shooter = null;
      }
    }
    ctx.globalAlpha = 1;
  };
  const loop = (t) => { draw(t); raf = requestAnimationFrame(loop); };
  build();
  nextShot = 4000;
  if (reduceMotion) { draw(0); addEventListener("scroll", () => draw(0), { passive: true }); }
  else {
    raf = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(loop); });
    addEventListener("pointermove", (e) => { mx = (e.clientX / w - 0.5) * -2; my = (e.clientY / h - 0.5) * -2; }, { passive: true });
  }
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { build(); if (reduceMotion) draw(0); }, 150); });
})();

// reading progress
const bar = document.querySelector(".scroll-progress");
const progress = () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  bar?.style.setProperty("--sp", max > 0 ? (scrollY / max).toFixed(4) : "0");
};
addEventListener("scroll", progress, { passive: true });
progress();
