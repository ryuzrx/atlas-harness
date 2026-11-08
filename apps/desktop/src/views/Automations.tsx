import React from "react";
import { Clock3, Sparkles } from "lucide-react";
import { Button, Card } from "../components/ui";

export function Automations() {
  return <div className="mx-auto w-full max-w-[920px] pt-4">
    <header className="flex items-center justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Automations</h1>
        <p className="mt-1 text-sm text-ink-2">Scheduled prompts and recurring work.</p></div>
      <div className="flex gap-2">
        <Button disabled title="Scheduled prompts are not available yet" icon={<Sparkles size={14} />}>Create with Prompt</Button>
        <Button disabled title="Scheduled prompts are not available yet">＋ New</Button>
      </div>
    </header>
    <Card className="mt-10 p-8 min-h-[260px] flex flex-col items-center justify-center text-center">
      <span className="h-12 w-12 rounded-xl bg-active flex items-center justify-center text-ink-2"><Clock3 size={22} /></span>
      <h2 className="mt-4 text-lg font-medium text-ink">No automations yet</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-2">Scheduled runs are not available in this build yet. Your recurring prompts will appear here when scheduling is ready.</p>
    </Card>
  </div>;
}
