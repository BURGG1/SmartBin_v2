import { useCallback, useEffect, useRef, useState } from "react";

// One serial-port owner shared by Register Household and Assign RFID.
let sharedPort = null;
let sharedReader = null;
let readTask = null;
let activeConsumer = null;
let activeOwner = null;
let sharedConnected = false;
let sharedStatus = "USB not connected";
const listeners = new Set();

function publish(status, connected = sharedConnected) {
  sharedStatus = status;
  sharedConnected = connected;
  listeners.forEach((listener) => listener({ connected: sharedConnected, status: sharedStatus }));
}

async function startReading(port) {
  if (readTask) return;
  sharedPort = port;
  try {
    if (!port.readable) await port.open({ baudRate: 115200 });
    publish("USB reader connected", true);
    readTask = (async () => {
      const reader = port.readable.pipeThrough(new TextDecoderStream()).getReader();
      sharedReader = reader;
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          buffer += value;
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const message = line.trim();
            if (!message.startsWith("USB_RFID|")) continue;
            const uid = message.slice("USB_RFID|".length).trim().toUpperCase();
            if (/^(?:[0-9A-F]{2}-){3,9}[0-9A-F]{2}$/.test(uid)) activeConsumer?.(uid, "USB");
          }
        }
      } finally {
        try { reader.releaseLock(); } catch {}
      }
    })();
    await readTask;
  } catch (error) {
    publish(`USB disconnected${error?.message ? `: ${error.message}` : ""}`, false);
  } finally {
    sharedReader = null;
    readTask = null;
    sharedPort = null;
    publish("USB not connected", false);
    try { if (port.readable || port.writable) await port.close(); } catch {}
  }
}

async function autoConnect() {
  if (!("serial" in navigator)) {
    publish("USB serial unavailable in this browser", false);
    return;
  }
  if (sharedPort || readTask) return;
  try {
    const ports = await navigator.serial.getPorts();
    if (ports.length) {
      publish("Reconnecting to saved USB reader…", false);
      void startReading(ports[0]);
    } else {
      publish("USB ready · select Enable USB once", false);
    }
  } catch {
    publish("USB reconnect unavailable · select Enable USB", false);
  }
}

async function requestConnection() {
  if (!("serial" in navigator)) {
    publish("USB serial unavailable in this browser", false);
    return;
  }
  if (sharedPort || readTask) {
    publish("USB reader connected", true);
    return;
  }
  try {
    const port = await navigator.serial.requestPort();
    void startReading(port);
  } catch (error) {
    if (error?.name !== "NotFoundError") publish(`USB connection failed: ${error?.message || "Check the COM port"}`, false);
  }
}

export default function useSharedRfidUsb({ isActive, onUid }) {
  const callbackRef = useRef(onUid);
  const ownerRef = useRef({});
  const [state, setState] = useState({ connected: sharedConnected, status: sharedStatus });
  callbackRef.current = onUid;

  useEffect(() => {
    const listener = (next) => setState(next);
    listeners.add(listener);
    listener({ connected: sharedConnected, status: sharedStatus });
    return () => listeners.delete(listener);
  }, []);

  useEffect(() => {
    if (isActive) {
      activeOwner = ownerRef.current;
      activeConsumer = (uid, source) => callbackRef.current?.(uid, source);
      void autoConnect();
    } else if (activeOwner === ownerRef.current) {
      activeOwner = null;
      activeConsumer = null;
    }
  }, [isActive]);

  const connect = useCallback(() => requestConnection(), []);
  return { usbConnected: state.connected, usbStatus: state.status, connectUsb: connect };
}
