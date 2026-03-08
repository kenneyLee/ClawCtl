import { useState } from "react";
import { X, Plus } from "lucide-react";

export interface ChannelFormValues {
  enabled: boolean;
  dmPolicy: string;
  groupPolicy: string;
  allowFrom: string[];
  groupAllowFrom: string[];
  historyLimit: number | "";
  dmHistoryLimit: number | "";
  textChunkLimit: number | "";
  chunkMode: string;
  blockStreaming: boolean;
}

interface ChannelFormProps {
  values: ChannelFormValues;
  onChange: (values: ChannelFormValues) => void;
  channelType: string;
  accountId: string;
}

const DM_POLICY_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "pairing", label: "Pairing" },
  { value: "allowlist", label: "Allowlist" },
  { value: "open", label: "Open" },
  { value: "disabled", label: "Disabled" },
];

const GROUP_POLICY_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "open", label: "Open" },
  { value: "deny", label: "Deny" },
  { value: "allowlist", label: "Allowlist" },
];

const CHUNK_MODE_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "split", label: "Split" },
  { value: "truncate", label: "Truncate" },
];

export function ChannelForm({ values, onChange, channelType, accountId }: ChannelFormProps) {
  const [allowFromInput, setAllowFromInput] = useState("");
  const [groupAllowFromInput, setGroupAllowFromInput] = useState("");

  const set = <K extends keyof ChannelFormValues>(key: K, val: ChannelFormValues[K]) =>
    onChange({ ...values, [key]: val });

  const addAllowFrom = () => {
    const entry = allowFromInput.trim();
    if (entry && !values.allowFrom.includes(entry)) {
      set("allowFrom", [...values.allowFrom, entry]);
    }
    setAllowFromInput("");
  };

  const removeAllowFrom = (entry: string) => {
    set("allowFrom", values.allowFrom.filter((e) => e !== entry));
  };

  const addGroupAllowFrom = () => {
    const entry = groupAllowFromInput.trim();
    if (entry && !values.groupAllowFrom.includes(entry)) {
      set("groupAllowFrom", [...values.groupAllowFrom, entry]);
    }
    setGroupAllowFromInput("");
  };

  const removeGroupAllowFrom = (entry: string) => {
    set("groupAllowFrom", values.groupAllowFrom.filter((e) => e !== entry));
  };

  return (
    <div className="space-y-4">
      {/* Channel / Account info (read-only) */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-ink-3 mb-1">Channel Type</label>
          <div className="px-3 py-2 text-sm bg-s2/50 border border-edge rounded text-ink-2 font-mono">{channelType}</div>
        </div>
        <div>
          <label className="block text-xs text-ink-3 mb-1">Account ID</label>
          <div className="px-3 py-2 text-sm bg-s2/50 border border-edge rounded text-ink-2 font-mono">{accountId}</div>
        </div>
      </div>

      {/* Enabled */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={values.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
          className="rounded border-edge"
        />
        <label className="text-sm text-ink">Enabled</label>
      </div>

      {/* DM Policy */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">DM Policy</label>
        <select
          value={values.dmPolicy}
          onChange={(e) => set("dmPolicy", e.target.value)}
          className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink focus:outline-none focus:border-cyan"
        >
          {DM_POLICY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Group Policy */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">Group Policy</label>
        <select
          value={values.groupPolicy}
          onChange={(e) => set("groupPolicy", e.target.value)}
          className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink focus:outline-none focus:border-cyan"
        >
          {GROUP_POLICY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Allow From (DM) */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">Allow From (DM)</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {values.allowFrom.map((entry) => (
            <span key={entry} className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-cyan-dim text-cyan">
              {entry}
              <button onClick={() => removeAllowFrom(entry)} className="hover:text-danger"><X size={12} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={allowFromInput}
            onChange={(e) => setAllowFromInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAllowFrom(); } }}
            placeholder="Add user/peer ID..."
            className="flex-1 px-3 py-1.5 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan"
          />
          <button onClick={addAllowFrom} className="px-2 py-1.5 text-sm rounded bg-s2 border border-edge text-ink hover:bg-s3">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Group Allow From */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">Allow From (Group)</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {values.groupAllowFrom.map((entry) => (
            <span key={entry} className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-cyan-dim text-cyan">
              {entry}
              <button onClick={() => removeGroupAllowFrom(entry)} className="hover:text-danger"><X size={12} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={groupAllowFromInput}
            onChange={(e) => setGroupAllowFromInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGroupAllowFrom(); } }}
            placeholder="Add group/chat ID..."
            className="flex-1 px-3 py-1.5 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan"
          />
          <button onClick={addGroupAllowFrom} className="px-2 py-1.5 text-sm rounded bg-s2 border border-edge text-ink hover:bg-s3">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* History Limits — 2-col grid */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-ink-3 mb-1">History Limit</label>
          <input
            type="number"
            value={values.historyLimit}
            onChange={(e) => set("historyLimit", e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="Default"
            className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-3 mb-1">DM History Limit</label>
          <input
            type="number"
            value={values.dmHistoryLimit}
            onChange={(e) => set("dmHistoryLimit", e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="Default"
            className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan"
          />
        </div>
      </div>

      {/* Text Chunk Limit + Chunk Mode — 2-col grid */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-ink-3 mb-1">Text Chunk Limit</label>
          <input
            type="number"
            value={values.textChunkLimit}
            onChange={(e) => set("textChunkLimit", e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="Default"
            className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-3 mb-1">Chunk Mode</label>
          <select
            value={values.chunkMode}
            onChange={(e) => set("chunkMode", e.target.value)}
            className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink focus:outline-none focus:border-cyan"
          >
            {CHUNK_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Block Streaming */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={values.blockStreaming}
          onChange={(e) => set("blockStreaming", e.target.checked)}
          className="rounded border-edge"
        />
        <label className="text-sm text-ink">Block Streaming</label>
      </div>
    </div>
  );
}
