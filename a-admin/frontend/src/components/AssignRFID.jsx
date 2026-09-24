import { X, Asterisk } from "lucide-react";
import { useState, useEffect } from "react";
import SuccessToast from "../assets/Toast";
import BASE_URL from "../config";

export default function AssignRFIDModal({ isOpen, onClose, onAssign }) {
    const [rfid, setRfid]       = useState("");
    const [toast, setToast]     = useState(false);
    const [error, setError]     = useState("");
    const [polling, setPolling] = useState(true); // stop polling once filled

    // ── Poll for latest unregistered scan every 2 seconds ────────────────────
    useEffect(() => {
        if (!isOpen) return;

        setRfid("");
        setError("");
        setPolling(true);

        const interval = setInterval(async () => {
            if (!polling) return;

            try {
                const res  = await fetch(`${BASE_URL}/api/rfid/latest-scan`);
                const data = await res.json();
                if (data.success && data.rfid) {
                    setRfid(data.rfid);
                    setPolling(false); // stop polling once we have an RFID
                }
            } catch {
                // backend not reachable — silently ignore
            }
        }, 2000);

        return () => clearInterval(interval);
    }, [isOpen]); // only re-run when modal opens/closes

    // Stop polling when rfid is filled manually or via scan
    useEffect(() => {
        if (rfid) setPolling(false);
        else      setPolling(true);
    }, [rfid]);

    // ── Must be after all hooks ───────────────────────────────────────────────
    if (!isOpen) return null;

    const handleAssign = () => {
        if (!rfid.trim()) {
            setError("Please scan an RFID card first.");
            return;
        }
        setError("");
        onAssign(rfid.trim().toUpperCase());
        setRfid("");
        setPolling(true);
        setToast(true);
        onClose();
    };

    const handleClose = () => {
        setRfid("");
        setError("");
        setPolling(true);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-lg overflow-hidden">

                {/* HEADER */}
                <div className="flex justify-between items-center px-6 py-4 border-b">
                    <h2 className="text-lg font-bold">Assign RFID</h2>
                    <button onClick={handleClose}>
                        <X className="text-gray-500 hover:text-gray-800 cursor-pointer" />
                    </button>
                </div>

                {/* BODY */}
                <div className="p-6 flex flex-col gap-4">

                    <div className="flex flex-col items-center">
                        <div className="flex items-center gap-1">
                            <h3 className="text-lg font-semibold">Scan RFID Card</h3>
                            <Asterisk className="text-red-500 w-3 h-3" />
                        </div>
                        <p className="text-sm text-gray-500 text-center mt-1">
                            Hold the card near the desk reader — it will auto-fill below
                        </p>
                    </div>

                    {/* RFID INPUT */}
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                            <input
                                readOnly
                                type="text"
                                name="rfid"
                                value={rfid}
                                onChange={(e) => setRfid(e.target.value.toUpperCase())}
                                placeholder={polling ? "Waiting for scan..." : "RFID auto-filled"}
                                className={`w-full px-3 py-2 border rounded-lg transition ${
                                    rfid
                                        ? "border-green-500 bg-green-50 text-green-700 font-mono"
                                        : "border-gray-300"
                                }`}
                            />
                        </div>

                        {/* Polling indicator */}
                        {polling && !rfid && (
                            <p className="text-xs text-gray-400 flex items-center gap-1">
                                <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                                Listening for card scan...
                            </p>
                        )}

                        {/* RFID confirmed */}
                        {rfid && (
                            <p className="text-xs text-green-600 flex items-center gap-1">
                                ✅ Card detected: <span className="font-mono font-semibold">{rfid}</span>
                            </p>
                        )}

                        {/* Error */}
                        {error && (
                            <p className="text-xs text-red-500">{error}</p>
                        )}
                    </div>

                    {/* BUTTONS */}
                    <div className="flex gap-2 mt-2">
                        <button
                            onClick={handleClose}
                            className="flex-1 border border-gray-300 text-gray-700 cursor-pointer py-2 rounded-lg hover:bg-gray-50 transition"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleAssign}
                            disabled={!rfid}
                            className="flex-1 bg-green-600 cursor-pointer text-white py-2 rounded-lg hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Assign
                        </button>
                    </div>

                </div>
            </div>

            <SuccessToast
                show={toast}
                onClose={() => setToast(false)}
                message="RFID assigned successfully!"
            />
        </div>
    );
}