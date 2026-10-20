import { X, Asterisk } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import useSharedRfidUsb from "./useSharedRfidUsb";
import SuccessToast from "../assets/Toast";
import BASE_URL from "../config";

export default function AssignRFIDModal({ isOpen, onClose, onAssign }) {
    const [rfid, setRfid] = useState("");
    const [toast, setToast] = useState(false);
    const [error, setError] = useState("");
    const [wifiStatus, setWifiStatus] = useState("Wi-Fi polling waiting");
    const rfidValueRef = useRef("");

    const handleUsbUid = (uid) => {
        if (rfidValueRef.current) return;
        rfidValueRef.current = uid;
        setRfid(uid);
        setError("");
    };
    const { usbConnected, usbStatus, connectUsb } = useSharedRfidUsb({
        isActive: isOpen,
        onUid: handleUsbUid,
    });

    // Wi-Fi fallback runs alongside USB Serial. The first valid UID wins.
    useEffect(() => {
        if (!isOpen) return;

        let cancelled = false;
        setWifiStatus("Wi-Fi polling active");

        const pollLatestScan = async () => {
            if (cancelled || rfidValueRef.current) return;
            try {
                const response = await fetch(`${BASE_URL}/api/rfid/latest-scan`, {
                    cache: "no-store",
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                if (cancelled || rfidValueRef.current) return;

                if (data?.success && typeof data.rfid === "string") {
                    const uid = data.rfid.trim().toUpperCase();
                    if (/^(?:[0-9A-F]{2}-){3,9}[0-9A-F]{2}$/.test(uid)) {
                        rfidValueRef.current = uid;
                        setRfid(uid);
                        setError("");
                        setWifiStatus(`RFID received via Wi-Fi: ${uid}`);
                    }
                }
            } catch {
                if (!cancelled) setWifiStatus("Wi-Fi polling unavailable; USB can still receive scans.");
            }
        };

        void pollLatestScan();
        const interval = setInterval(pollLatestScan, 2000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            setRfid("");
            rfidValueRef.current = "";
            setError("");
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleAssign = () => {
        if (!rfid.trim()) {
            setError("Please scan an RFID card first.");
            return;
        }
        setError("");
        onAssign(rfid.trim().toUpperCase());
        setRfid("");
        rfidValueRef.current = "";
        setToast(true);
        onClose();
    };

    const handleClose = () => {
        setRfid("");
        rfidValueRef.current = "";
        setError("");
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-lg overflow-hidden">
                <div className="flex justify-between items-center px-6 py-4 border-b">
                    <h2 className="text-lg font-bold">Assign RFID</h2>
                    <button type="button" onClick={handleClose} aria-label="Close">
                        <X className="text-gray-500 hover:text-gray-800 cursor-pointer" />
                    </button>
                </div>

                <div className="p-6 flex flex-col gap-4">
                    <div className="flex flex-col items-center">
                        <div className="flex items-center gap-1">
                            <h3 className="text-lg font-semibold">Scan RFID Card</h3>
                            <Asterisk className="text-red-500 w-3 h-3" />
                        </div>
                        <p className="text-sm text-gray-500 text-center mt-1">
                            Scan by USB or Wi-Fi. Whichever delivers the UID first will fill this field.
                        </p>
                    </div>

                    <div className="flex items-center justify-between gap-3 -mt-1">
                        <p role="status" className="text-xs text-gray-500 flex items-center gap-1.5">
                            <span className={`inline-block w-2 h-2 rounded-full ${usbConnected ? "bg-green-500" : "bg-gray-300"}`} />
                            {usbConnected ? "USB reader connected" : usbStatus}
                        </p>
                        {!usbConnected && <button type="button" onClick={() => void connectUsb()} className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-700 underline underline-offset-2">Enable USB</button>}
                    </div>
                    <p role="status" className="text-xs text-gray-500">Wi-Fi scan is also active. {wifiStatus}</p>

                    <div className="flex flex-col gap-1">
                        <input
                            readOnly
                            type="text"
                            name="rfid"
                            value={rfid}
                            placeholder={usbConnected ? "Waiting for RFID scan..." : "Scan RFID card"}
                            className={`w-full px-3 py-2 border rounded-lg transition ${rfid ? "border-green-500 bg-green-50 text-green-700 font-mono" : "border-gray-300"}`}
                        />
                        {rfid && (
                            <p className="text-xs text-green-600">
                                Card detected: <span className="font-mono font-semibold">{rfid}</span>
                            </p>
                        )}
                        {error && <p className="text-xs text-red-500">{error}</p>}
                    </div>

                    <div className="flex gap-2 mt-2">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="flex-1 border border-gray-300 text-gray-700 cursor-pointer py-2 rounded-lg hover:bg-gray-50 transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
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
