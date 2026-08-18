import { useEffect, useRef, useState } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:4000/ws";

export default function useWebSocket(shouldConnect, onMessage) {
  const ws = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!shouldConnect) return;
    if (ws.current) return;

    const socket = new WebSocket(WS_URL);
    ws.current = socket;

    socket.onopen = () => {
      setConnected(true);
      console.log("✅ WebSocket connected");
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onMessage(data);
    };

    socket.onclose = () => {
      setConnected(false);
      console.log("⚠️ WebSocket closed");
      if (ws.current === socket) {
        ws.current = null;
      }
    };

    socket.onerror = (err) => {
      console.error("❌ WebSocket error:", err);
    };

    return () => {
      setConnected(false);
      socket.close();
      if (ws.current === socket) {
        ws.current = null;
      }
    };
  }, [shouldConnect]);

  const send = (msg) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
      return true;
    }
    return false;
  };

  return { send, connected };
}
