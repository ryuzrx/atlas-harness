import React from "react";

type ServerLike = { name: string; command?: string; args?: string[] };

type Mark = { bg: string; glyph: React.ReactNode };

const MARKS: Record<string, Mark> = {
  filesystem: {
    bg: "#3B82F6",
    glyph: (
      <>
        <path d="M3.4 7.8h5.1l1.8 2h9.7a1 1 0 0 1 1 1v6.5a2 2 0 0 1-2 2H4.4a2 2 0 0 1-2-2V8.8a1 1 0 0 1 1-1Z" stroke="#fff" />
        <path d="M4 12.4h16.4" stroke="#fff" opacity=".5" />
      </>
    ),
  },
  github: {
    bg: "#fff",
    glyph: (
      <path fill="#181717" stroke="none" d="M12 2C6.5 2 2 6.6 2 12.2c0 4.5 2.9 8.3 6.8 9.7.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.7-1.4-2.3-.3-4.7-1.2-4.7-5.1 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1.1a9.3 9.3 0 0 1 5 0c1.9-1.4 2.8-1.1 2.8-1.1.5 1.4.2 2.4.1 2.7.7.7 1 1.6 1 2.7 0 3.9-2.4 4.8-4.7 5.1.4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10.2 10.2 0 0 0 22 12.2C22 6.6 17.5 2 12 2Z" />
    ),
  },
  slack: {
    bg: "#fff",
    glyph: (
      <g transform="scale(0.189)">
        <path d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z" fill="#E01E5A" />
        <path d="M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.1.7 54.2.7 46.9c0-7.3 5.9-13.2 13.2-13.2H47z" fill="#36C5F0" />
        <path d="M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6c7.3 0 13.2 5.9 13.2 13.2v33.1z" fill="#2EB67D" />
        <path d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z" fill="#ECB22E" />
      </g>
    ),
  },
  notion: {
    bg: "#fff",
    glyph: (
      <>
        <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="3.4" stroke="#111" />
        <path d="M8.4 16.8V7.2l7.2 9.6V7.2" stroke="#111" />
      </>
    ),
  },
  linear: {
    bg: "#5E6AD2",
    glyph: <path fill="#fff" d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z" />,
  },
  sentry: {
    bg: "#362D59",
    glyph: <path fill="#fff" d="M13.91 2.505c-.873-1.448-2.972-1.448-3.844 0L6.904 7.92a15.478 15.478 0 0 1 8.53 12.811h-2.221A13.301 13.301 0 0 0 5.784 9.814l-2.926 5.06a7.65 7.65 0 0 1 4.435 5.848H2.194a.365.365 0 0 1-.298-.534l1.413-2.402a5.16 5.16 0 0 0-1.614-.913L.296 19.275a2.182 2.182 0 0 0 .812 2.999 2.24 2.24 0 0 0 1.086.288h6.983a9.322 9.322 0 0 0-3.845-8.318l1.11-1.922a11.47 11.47 0 0 1 4.95 10.24h5.915a17.242 17.242 0 0 0-7.885-15.28l2.244-3.845a.37.37 0 0 1 .504-.13c.255.14 9.75 16.708 9.928 16.9a.365.365 0 0 1-.327.543h-2.287c.029.612.029 1.223 0 1.831h2.297a2.206 2.206 0 0 0 1.922-3.31z" />,
  },
  postgres: {
    bg: "#336791",
    glyph: (
      <>
        <ellipse cx="12" cy="5.2" rx="6.6" ry="2.7" stroke="#fff" />
        <path d="M5.4 5.2v6.4c0 1.5 3 2.7 6.6 2.7s6.6-1.2 6.6-2.7V5.2M5.4 11.6v6.4c0 1.5 3 2.7 6.6 2.7s6.6-1.2 6.6-2.7v-6.4" stroke="#fff" />
      </>
    ),
  },
  drive: {
    bg: "#fff",
    glyph: (
      <g transform="translate(0 1.28) scale(0.2749)">
        <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA" />
        <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00AC47" />
        <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#EA4335" />
        <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832D" />
        <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684FC" />
        <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00" />
      </g>
    ),
  },
  memory: {
    bg: "#D97706",
    glyph: (
      <>
        <rect x="6" y="6" width="12" height="12" rx="3" stroke="#fff" />
        <path d="M9.5 2.8v3.2M14.5 2.8v3.2M9.5 18v3.2M14.5 18v3.2M2.8 9.5h3.2M2.8 14.5h3.2M18 9.5h3.2M18 14.5h3.2" stroke="#fff" />
      </>
    ),
  },
  brave: {
    bg: "#FB542B",
    glyph: (
      <>
        <circle cx="10.6" cy="10.6" r="6.4" stroke="#fff" />
        <path d="m15.2 15.2 4.8 4.8" stroke="#fff" />
        <path d="m10.6 7.2.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z" fill="#fff" stroke="none" />
      </>
    ),
  },
  puppeteer: {
    bg: "#00A9A5",
    glyph: (
      <>
        <rect x="2.8" y="4" width="18.4" height="15.2" rx="2.6" stroke="#fff" />
        <path d="M2.8 8.2h18.4" stroke="#fff" />
        <path d="m8 12.2 3.2 2.1L8 16.4v-4.2Z" fill="#fff" stroke="none" />
        <path d="M14 16.2h3" stroke="#fff" />
      </>
    ),
  },
  figma: {
    bg: "#fff",
    glyph: (
      <>
        <path d="M9 2.8h3v6H9a3 3 0 1 1 0-6Z" fill="#F24E1E" stroke="none" />
        <path d="M12 2.8h3a3 3 0 1 1 0 6h-3v-6Z" fill="#FF7262" stroke="none" />
        <path d="M9 8.8h3v6H9a3 3 0 1 1 0-6Z" fill="#A259FF" stroke="none" />
        <circle cx="15" cy="11.8" r="3" fill="#1ABCFE" stroke="none" />
        <path d="M9 14.8h3v3a3 3 0 1 1-3-3Z" fill="#0ACF83" stroke="none" />
      </>
    ),
  },
};

function keyFor(server: ServerLike) {
  const text = [server.name, server.command, ...(server.args || [])].join(" ").toLowerCase();
  if (text.includes("github")) return "github";
  if (text.includes("slack")) return "slack";
  if (text.includes("notion")) return "notion";
  if (text.includes("linear")) return "linear";
  if (text.includes("sentry")) return "sentry";
  if (text.includes("postgres") || text.includes("postgresql")) return "postgres";
  if (text.includes("google drive") || text.includes("gdrive") || text.includes("drive")) return "drive";
  if (text.includes("memory")) return "memory";
  if (text.includes("brave") || text.includes("search")) return "brave";
  if (text.includes("puppeteer") || text.includes("playwright") || text.includes("browser")) return "puppeteer";
  if (text.includes("figma")) return "figma";
  if (text.includes("filesystem") || text.includes("file-system")) return "filesystem";
  return null;
}

function initials(name: string) {
  const words = name.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const text = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return text.toUpperCase();
}

/** Colored app marks for the integration directory. */
export function IntegrationMark({ server, size = 40, className }: {
  server: ServerLike;
  size?: number;
  className?: string;
}) {
  const mark = MARKS[keyFor(server) || ""];
  return (
    <span aria-hidden
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-[12px] ring-1 ring-inset ring-black/10 shadow-[0_1px_2px_rgba(0,0,0,0.18)] ${mark ? "" : "bg-active ring-white/5"} ${className || ""}`}
      style={{ width: size, height: size, ...(mark ? { background: mark.bg } : {}) }}>
      {mark ? (
        <svg width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} viewBox="0 0 24 24" fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          {mark.glyph}
        </svg>
      ) : (
        <span style={{ fontSize: size * 0.28 }} className="font-semibold tracking-[0.02em] text-ink-2">{initials(server.name)}</span>
      )}
    </span>
  );
}
