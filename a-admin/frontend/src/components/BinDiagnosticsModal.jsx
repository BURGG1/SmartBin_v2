import { useCallback, useEffect, useState } from "react";
import {
    X,
    RefreshCw,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    HelpCircle,
} from "lucide-react";
import BASE_URL from "../config";

const COMPONENTS = [
    ["wifi", "Wi-Fi"],
    ["rfid", "RFID reader"],
    ["fillSensor", "Fill-level sensor"],
    ["objectSensor", "Object sensor"],
    ["gps", "GPS"],
    ["actuator", "Actuator"],
    ["solenoid", "Solenoid lock"],
    ["backend", "Backend connection"],
];

const STATUSES = {
    working: {
        label: "Working",
        Icon: CheckCircle2,
        style: "bg-green-50 text-green-700",
    },
    warning: {
        label: "Warning",
        Icon: AlertTriangle,
        style: "bg-amber-50 text-amber-800",
    },
    fault: {
        label: "Fault",
        Icon: XCircle,
        style: "bg-red-50 text-red-700",
    },
    unknown: {
        label: "Cannot verify",
        Icon: HelpCircle,
        style: "bg-gray-100 text-gray-600",
    },
};

function formatDate(value) {
    if (!value) return "No report received";

    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? "Invalid date"
        : date.toLocaleString();
}

export default function BinDiagnosticsModal({ isOpen, onClose, bin }) {
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    // binId must be the actual identifier, e.g. BIN-001.
    const binId = bin?.binId || bin?.id;

    const loadReport = useCallback(
        async (signal) => {
            if (!binId) {
                setError("This bin has no binId.");
                return;
            }

            setLoading(true);
            setError("");

            try {

                const token = sessionStorage.getItem("token");

                const response = await fetch(
                    `${BASE_URL}/api/bins/${encodeURIComponent(binId)}/diagnostics`,
                    {
                        method: "GET",
                        cache: "no-store",
                        credentials: "include",
                        headers: {
                            Accept: "application/json",
                            "Cache-Control": "no-cache",
                            ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        },
                        signal,
                    }
                );


                const body = await response.json().catch(() => ({}));

                if (!response.ok) {
                    throw new Error(
                        body.message || `Request failed (${response.status})`
                    );
                }

                const data = body.data;

                setReport(
                    data?.diagnostics
                        ? {
                            ...data.diagnostics,
                            name: data.name,
                            stale: data.diagnostics.stale ?? false,
                        }
                        : data?.components
                            ? data
                            : null
                );
            } catch (err) {
                if (err.name !== "AbortError") {
                    setError(err.message || "Unable to load diagnostics.");
                }
            } finally {
                if (!signal?.aborted) setLoading(false);
            }
        },
        [binId]
    );

    useEffect(() => {
        if (!isOpen) return undefined;

        const controller = new AbortController();
        loadReport(controller.signal);

        return () => controller.abort();
    }, [isOpen, loadReport]);

    if (!isOpen || !bin) return null;

    const overall = STATUSES[report?.overallStatus] || STATUSES.unknown;
    const OverallIcon = overall.Icon;
    const components = report?.components || {};

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bin-diagnostics-title"
        >
            <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
                <header className="flex items-center justify-between border-b p-5">
                    <div>
                        <h2 id="bin-diagnostics-title" className="text-xl font-bold">
                            Bin Diagnostics
                        </h2>
                        <p className="mt-1 text-sm text-gray-500">
                            {binId} · {report?.name || bin.name || "SmartBin"}
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-2 hover:bg-gray-100"
                        aria-label="Close diagnostics"
                    >
                        <X size={20} />
                    </button>
                </header>

                <main className="space-y-5 overflow-y-auto p-5">
                    <section className={`rounded-xl p-4 ${overall.style}`}>
                        <div className="flex items-start gap-3">
                            <OverallIcon size={24} />
                            <div>
                                <p className="font-semibold">
                                    Overall status: {overall.label}
                                </p>
                                <p className="mt-1 text-sm">
                                    Last report: {formatDate(report?.reportedAt)}
                                </p>

                                {report?.stale && (
                                    <p className="mt-1 text-sm font-medium">
                                        Report is stale. Current component health cannot
                                        be confirmed.
                                    </p>
                                )}

                                {!report?.reportedAt && (
                                    <p className="mt-1 text-sm">
                                        The ESP32 has not submitted a report yet.
                                    </p>
                                )}
                            </div>
                        </div>
                    </section>

                    {loading && (
                        <p className="text-sm text-gray-500">Loading diagnostics…</p>
                    )}

                    {error && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                            {error}
                        </div>
                    )}

                    <section className="grid gap-3 sm:grid-cols-2">
                        {COMPONENTS.map(([key, label]) => {
                            const item = components[key] || {};
                            const status = STATUSES[item.status] || STATUSES.unknown;
                            const Icon = status.Icon;

                            return (
                                <article key={key} className="rounded-xl border p-4">
                                    <div className="flex items-start justify-between gap-2">
                                        <h3 className="font-medium">{label}</h3>
                                        <span
                                            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs ${status.style}`}
                                        >
                                            <Icon size={13} />
                                            {status.label}
                                        </span>
                                    </div>
                                    <p className="mt-2 break-words text-sm text-gray-600">
                                        {item.message || "No diagnostic result reported."}
                                    </p>
                                </article>
                            );
                        })}
                    </section>

                    {report?.alerts?.length > 0 && (
                        <section>
                            <h3 className="mb-2 font-semibold">Recent alerts</h3>
                            <div className="space-y-2">
                                {report.alerts.slice(0, 10).map((alert, index) => (
                                    <article
                                        key={`${alert.key || alert.title}-${index}`}
                                        className="rounded-lg border p-3"
                                    >
                                        <p className="font-medium">{alert.title}</p>
                                        <p className="mt-1 text-sm text-gray-600">
                                            {alert.message}
                                        </p>
                                        <p className="mt-1 text-xs text-gray-400">
                                            {formatDate(alert.at)}
                                        </p>
                                    </article>
                                ))}
                            </div>
                        </section>
                    )}

                    <p className="text-xs leading-relaxed text-gray-500">
                        Relay commands cannot confirm physical actuator movement or
                        successful locking. Feedback hardware is required to verify
                        those functions.
                    </p>
                </main>

                <footer className="flex justify-end gap-2 border-t p-4">
                    <button
                        type="button"
                        onClick={() => loadReport()}
                        disabled={loading}
                        className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                    >
                        <RefreshCw
                            size={15}
                            className={loading ? "animate-spin" : ""}
                        />
                        Refresh
                    </button>

                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
                    >
                        Close
                    </button>
                </footer>
            </div>
        </div>
    );
}
