import { useState, useRef } from "react";
import { useInstances } from "../hooks/useInstances";
import { post } from "../lib/api";

export function Tools() {
  const { instances } = useInstances();
  const [diagInstance, setDiagInstance] = useState("");
  const [diagAgent, setDiagAgent] = useState("");
  const [diagTool, setDiagTool] = useState("");
  const [diagResult, setDiagResult] = useState<{ steps: { check: string; pass: boolean; detail: string }[]; suggestion?: string } | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);
  const diagResultRef = useRef<HTMLDivElement>(null);

  // Build tool matrix
  const allTools = new Set<string>();
  instances.forEach((inst) =>
    inst.agents.forEach((a) => (a.toolsAllow || []).forEach((t) => allTools.add(t)))
  );
  // Count how many agents allow each tool — most widely used tools sort first
  const toolAllowCount = new Map<string, number>();
  instances.forEach((inst) =>
    inst.agents.forEach((a) => (a.toolsAllow || []).forEach((t) => toolAllowCount.set(t, (toolAllowCount.get(t) || 0) + 1)))
  );
  const toolNames = [...allTools].sort((a, b) => {
    const diff = (toolAllowCount.get(b) || 0) - (toolAllowCount.get(a) || 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  const runDiagnostic = async () => {
    if (!diagInstance || !diagAgent || !diagTool) return;
    setDiagLoading(true);
    setDiagError(null);
    try {
      const r = await post<{ steps: { check: string; pass: boolean; detail: string }[]; suggestion?: string }>("/tools/diagnose", {
        instanceId: diagInstance, agentId: diagAgent, toolName: diagTool,
      });
      setDiagResult(r);
      setTimeout(() => diagResultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
    } catch (err: any) {
      setDiagResult(null);
      setDiagError(err.message || "Diagnostic failed");
    } finally {
      setDiagLoading(false);
    }
  };

  const selectedInst = instances.find((i) => i.id === diagInstance);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Tool Diagnostics</h1>

      {/* Diagnostic wizard — top of page for visibility */}
      <div className="bg-s1 border border-edge rounded-card p-4 mb-6 shadow-card">
        <h2 className="text-lg font-semibold mb-3">Diagnostic Wizard</h2>
        <div className="flex gap-3 mb-4">
          <select value={diagInstance} onChange={(e) => { setDiagInstance(e.target.value); setDiagAgent(""); }} className="bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink">
            <option value="">Instance</option>
            {instances.map((i) => <option key={i.id} value={i.id}>{i.connection.label || i.id}</option>)}
          </select>
          <select value={diagAgent} onChange={(e) => setDiagAgent(e.target.value)} className="bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink">
            <option value="">Agent</option>
            {(selectedInst?.agents || []).map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}
          </select>
          <input value={diagTool} onChange={(e) => setDiagTool(e.target.value)} placeholder="Tool name (e.g. search)" className="bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors flex-1" />
          <button onClick={runDiagnostic} disabled={diagLoading || !diagInstance || !diagAgent || !diagTool} className="px-4 py-2 bg-brand hover:bg-brand-light rounded-lg text-sm text-white font-medium disabled:opacity-50">
            {diagLoading ? "Running..." : "Diagnose"}
          </button>
        </div>

        {diagError && (
          <div className="p-3 bg-danger-dim border border-danger/30 rounded-card text-sm text-danger mb-3">
            {diagError}
          </div>
        )}

        {diagResult && (
          <div ref={diagResultRef} className="space-y-2">
            {diagResult.steps.map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className={step.pass ? "text-ok" : "text-danger"}>{step.pass ? "\u2713" : "\u2717"}</span>
                <span className="font-medium">{step.check}:</span>
                <span className="text-ink-2">{step.detail}</span>
              </div>
            ))}
            {diagResult.suggestion && (
              <div className="mt-3 p-3 bg-cyan-dim border border-cyan/30 rounded-card text-sm">
                <span className="font-medium">Suggestion: </span>{diagResult.suggestion}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tool matrix */}
      {toolNames.length > 0 && (
        <div className="bg-s1 border border-edge rounded-card overflow-hidden shadow-card">
          <h2 className="text-lg font-semibold p-4 border-b border-edge">Tool Availability Matrix</h2>
          <p className="px-4 pb-2 text-xs text-ink-3">
            <span className="text-ok">&#10003;</span> explicit &nbsp; <span className="text-cyan">&#10003;</span> wildcard (*) &nbsp; <span className="text-ink-3">—</span> not allowed
          </p>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-ink-2">
                  <th className="text-left p-3 sticky left-0 bg-s1">Tool</th>
                  {instances.flatMap((inst) =>
                    inst.agents.map((a) => (
                      <th key={`${inst.id}-${a.id}`} className="text-left p-3 text-xs">
                        <div>{inst.connection.label || inst.id}</div>
                        <div className="text-ink-3">{a.id}</div>
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {toolNames.map((tool) => (
                  <tr key={tool} className="border-b border-edge/50">
                    <td className="p-3 sticky left-0 bg-s1">{tool}</td>
                    {instances.flatMap((inst) =>
                      inst.agents.map((a) => {
                        const tools = a.toolsAllow || [];
                        const isWildcard = tools.includes("*") || tools.length === 0;
                        const isExplicit = tools.includes(tool);
                        return (
                          <td key={`${inst.id}-${a.id}`} className="p-3 text-center">
                            {isExplicit ? (
                              <span className="text-ok font-bold text-sm" title="Explicitly allowed">&#10003;</span>
                            ) : isWildcard ? (
                              <span className="text-cyan text-sm" title="Allowed via wildcard (*)">&#10003;</span>
                            ) : (
                              <span className="text-ink-3 text-sm" title="Not allowed">—</span>
                            )}
                          </td>
                        );
                      })
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
