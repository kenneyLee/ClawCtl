import { useEffect, useRef, useState } from "react";

export function useWebSocket(path: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [lastMessage, setLastMessage] = useState<any>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}${path}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      try { setLastMessage(JSON.parse(e.data)); } catch { /* ignore */ }
    };

    return () => { ws.close(); };
  }, [path]);

  return { lastMessage, connected };
}
