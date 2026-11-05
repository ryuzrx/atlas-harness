import React, { useState } from "react";
import { useApi } from "../api";
import { ExecutionViewer } from "../components/Execution";
import { Card, PageHeader, Tabs } from "../components/ui";
import { ResourcePanel } from "./Overview";

export function Activity() {
  const [tab, setTab] = useState<"events" | "audit" | "monitor">("events");
  const { data: audit = [] } = useApi<any[]>(tab === "audit" ? "/audit" : null, ["settings", "task", "provider"]);
  return (
    <div className="max-w-[1240px] mx-auto">
      <PageHeader title="Activity" subtitle="Every model request, tool call, file edit and state change — persisted and inspectable." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "events", label: "Execution events" }, { id: "monitor", label: "System monitor" }, { id: "audit", label: "Audit log" }]} />
      {tab === "events" && <ExecutionViewer height="calc(100vh - 250px)" />}
      {tab === "monitor" && <div className="max-w-[520px]"><ResourcePanel /><p className="text-[11.5px] text-ink-2 mt-2">All values are measured on this Mac (psutil and the Ollama API) and refresh every 4 seconds while visible. Token counts shown elsewhere are estimates unless marked measured.</p></div>}
      {tab === "audit" && (
        <Card className="overflow-hidden">
          {audit.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-4 h-9 border-b border-line last:border-0 text-[12.5px]">
              <span className="text-ink-3 tnum w-[150px] shrink-0">{new Date(a.at * 1000).toLocaleString()}</span>
              <span className="w-14 text-ink-2">{a.actor}</span>
              <span className="font-medium w-[150px]">{a.action.replace(/_/g, " ")}</span>
              <span className="text-ink-2 font-mono text-[11.5px] truncate selectable">{JSON.stringify(a.data)}</span>
            </div>))}
          {audit.length === 0 && <div className="p-6 text-center text-ink-2">No audited actions yet.</div>}
        </Card>)}
    </div>
  );
}
