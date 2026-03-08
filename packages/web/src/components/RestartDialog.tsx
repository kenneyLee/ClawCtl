import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { post } from "../lib/api";

interface RestartDialogProps {
  instanceId: string;
  open: boolean;
  onClose: () => void;
}

export function RestartDialog({ instanceId, open, onClose }: RestartDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  if (!open) return null;

  const doRestart = async () => {
    setBusy(true);
    setError("");
    try {
      await post(`/lifecycle/${instanceId}/restart`);
      setSuccess(true);
      setTimeout(() => { setSuccess(false); onClose(); }, 1500);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-s1 border border-edge rounded-card p-6 shadow-card max-w-sm w-full">
        <h3 className="text-lg font-semibold text-ink mb-2">Config Saved</h3>
        <p className="text-sm text-ink-2 mb-4">
          Configuration saved successfully. Restart the instance to apply changes?
        </p>
        {error && <p className="text-sm text-danger mb-3">{error}</p>}
        {success ? (
          <p className="text-sm text-green-400 text-center py-2">Restart command sent successfully</p>
        ) : (
          <div className="flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-ink-3 hover:text-ink rounded"
            >
              Later
            </button>
            <button
              onClick={doRestart}
              disabled={busy}
              className="flex items-center gap-1.5 px-4 py-2 text-sm rounded bg-brand text-white hover:bg-brand-light disabled:opacity-40"
            >
              <RotateCcw size={14} />
              {busy ? "Restarting..." : "Restart Now"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
