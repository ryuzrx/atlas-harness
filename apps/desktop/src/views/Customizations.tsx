import React, { useState } from "react";
import { Code2, Shapes, Plug, Puzzle, GitBranch, CircleDot, PanelsTopLeft, Bug, Palette } from "lucide-react";
import { Button, Card } from "../components/ui";
import { useStore } from "../store";

const groups = [
  { title: "Developer tools", description: "Connect tools for code, issues, and project work.", apps: ["GitHub", "GitLab", "Linear", "Jira", "Chrome DevTools"] },
  { title: "Design", description: "Bring design files and references into your workflow.", apps: ["Figma", "Penpot", "Adobe Creative Cloud"] },
];

const appIcons: Record<string, { icon: React.ElementType; color: string }> = {
  GitHub: { icon: Code2, color: "text-ink" },
  GitLab: { icon: GitBranch, color: "text-[#e24329]" },
  Linear: { icon: CircleDot, color: "text-[#8b7cff]" },
  Jira: { icon: PanelsTopLeft, color: "text-[#579dff]" },
  "Chrome DevTools": { icon: Bug, color: "text-[#62b755]" },
  Figma: { icon: Shapes, color: "text-[#a259ff]" },
  Penpot: { icon: Shapes, color: "text-[#eb5a40]" },
  "Adobe Creative Cloud": { icon: Palette, color: "text-[#ff4b4b]" },
};

export function Customizations() {
  const { setSettingsOpen } = useStore();
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const connect = () => { localStorage.setItem("atlas_settings_section", "Integrations"); setSettingsOpen(true); };
  return <div className="mx-auto w-full max-w-[1040px] pt-4">
    <header className="flex items-center justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Customizations</h1>
        <p className="mt-1 text-sm text-ink-2">Connect developer and design apps through your integrations.</p></div>
      <div className="flex rounded-lg border border-line p-1 text-sm"><span className="rounded-md bg-active px-3 py-1 text-ink">Browse</span><button onClick={connect} className="px-3 py-1 text-ink-2 hover:text-ink">Connected</button></div>
    </header>
    <label className="mt-6 flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-ink-3"><span aria-hidden="true">⌕</span>
      <input aria-label="Search customizations" value={query} placeholder="Search developer and design apps…" className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3" onChange={(e) => setQuery(e.target.value)} />
    </label>
    <Card className="mt-6 overflow-hidden">
      <div className="grid min-h-[220px] md:grid-cols-2">
        <div className="flex items-center justify-center gap-4 bg-gradient-to-br from-blue-950 to-indigo-900 p-8 text-white"><div className="grid h-24 w-24 place-items-center rounded-2xl border border-white/10 bg-black/25"><Puzzle size={40} /></div><div className="grid h-16 w-16 place-items-center rounded-xl border border-white/10 bg-black/25"><Shapes size={28} /></div></div>
        <div className="flex flex-col justify-center p-8"><span className="text-xs font-medium text-ink-3">Featured</span><h2 className="mt-1 text-xl font-semibold text-ink">Developer & design tools</h2><p className="mt-2 text-sm leading-relaxed text-ink-2">Connect supported services in Integrations. Available tools depend on the MCP servers configured on this Mac.</p><Button className="mt-4 w-fit" variant="primary" icon={<Plug size={14} />} onClick={connect}>Open integrations</Button></div>
      </div>
    </Card>
    <div className="mt-8 space-y-8">
      {groups.map((group) => {
        const apps = group.apps.filter((name) => !normalized || name.toLowerCase().includes(normalized));
        if (!apps.length) return null;
        return <section key={group.title}>
        <div className="flex items-center gap-2"><Code2 size={17} className="text-ink-2" /><h2 className="text-lg font-medium text-ink">{group.title}</h2></div>
        <p className="mt-1 text-sm text-ink-2">{group.description}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {apps.map((name) => { const { icon: Icon, color } = appIcons[name] || { icon: Plug, color: "text-ink-2" }; return <div key={name} className="flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-hover">
            <span className={`grid h-10 w-10 shrink-0 place-items-center ${color}`}><Icon size={25} strokeWidth={1.8} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-ink">{name}</span><span className="block text-xs text-ink-3">Connect from integrations</span></span>
            <button aria-label={`Configure ${name}`} onClick={connect} className="h-8 w-8 rounded-md text-lg text-ink-2 hover:bg-active">＋</button>
          </div>; })}
        </div>
        </section>;
      })}
    </div>
  </div>;
}
