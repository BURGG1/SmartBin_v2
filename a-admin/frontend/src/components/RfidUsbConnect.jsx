
import { useRef, useState } from "react";

export default function RfidUsbConnect({ onUidReceived }) {
  const [status, setStatus] = useState("USB not connected");
  const [connected, setConnected] = useState(false);
  const readerRef = useRef(null);
  const portRef = useRef(null);
  const runningRef = useRef(false);

  async function connectUsb() {
    if (!("serial" in navigator)) {
      setStatus("Use Chrome or Edge on HTTPS");
      return;
    }

    try {
      // The user must click this button to choose the ESP32 port.
      const port = await navigator.serial.requestPort();

      await port.open({ baudRate: 115200 });

      portRef.current = port;
      runningRef.current = true;
      setConnected(true);
      setStatus("Connected. Waiting for RFID card...");

      const textStream = port.readable.pipeThrough(
        new TextDecoderStream()
      );
      const reader = textStream.getReader();
      readerRef.current = reader;

      let buffer = "";

      while (runningRef.current) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += value;

        // ESP32 sends each message ending in newline.
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const message = line.trim();

          if (!message.startsWith("USB_RFID|")) continue;

          const uid = message.slice("USB_RFID|".length).trim();

          // Accept a UID in the ESP32's hyphen-separated format.
          if (!/^(?:[0-9A-Fa-f]{2}-){3,9}[0-9A-Fa-f]{2}$/.test(uid)) {
            setStatus("Received an invalid RFID UID");
            continue;
          }

          onUidReceived(uid.toUpperCase());
          setStatus(`RFID received: ${uid.toUpperCase()}`);
        }
      }
    } catch (error) {
      if (error.name !== "NotFoundError") {
        setStatus(`USB error: ${error.message}`);
      }
    } finally {
      runningRef.current = false;
      readerRef.current = null;

      const port = portRef.current;
      portRef.current = null;

      if (port) {
        try {
          await port.close();
        } catch {
          // The port may already have closed.
        }
      }

      setConnected(false);
    }
  }

  async function disconnectUsb() {
    runningRef.current = false;

    try {
      await readerRef.current?.cancel();
    } catch {
      // Ignore cancellation errors during disconnect.
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={connected ? disconnectUsb : connectUsb}
      >
        {connected ? "Disconnect RFID USB" : "Connect RFID USB"}
      </button>

      <p role="status">{status}</p>
    </div>
  );
}
