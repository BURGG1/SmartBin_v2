
const Bin = require("../models/Bin");
const { createNotification } = require("./notificationController");

const COMPONENT_KEYS = [
  "wifi",
  "rfid",
  "fillSensor",
  "objectSensor",
  "gps",
  "actuator",
  "solenoid",
  "backend",
];

const VALID_STATUSES = new Set([
  "working",
  "warning",
  "fault",
  "unknown",
]);

const STALE_AFTER_MS = 3 * 60 * 1000;

function cleanText(value, maxLength) {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
}

function normalizeComponents(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const components = {};

  for (const key of COMPONENT_KEYS) {
    const item = input[key];

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      components[key] = {
        status: "unknown",
        message: "No diagnostic result reported.",
      };
      continue;
    }

    if (!VALID_STATUSES.has(item.status)) {
      return null;
    }

    components[key] = {
      status: item.status,
      message: cleanText(item.message, 240),
    };
  }

  return components;
}

function calculateOverallStatus(components) {
  const statuses = Object.values(components).map(
    (component) => component.status
  );

  if (statuses.includes("fault")) return "fault";
  if (statuses.includes("warning")) return "warning";

  if (statuses.length && statuses.every((status) => status === "working")) {
    return "working";
  }

  return "unknown";
}

function normalizeAlerts(input) {
  if (input === undefined) return [];

  if (!Array.isArray(input)) return null;

  return input.slice(0, 10).map((alert) => {
    const parsedDate = alert?.at ? new Date(alert.at) : new Date();

    return {
      title: cleanText(alert?.title, 100) || "Component alert",
      message: cleanText(alert?.message, 300),
      at: Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
      key: cleanText(alert?.key, 120),
    };
  });
}

function isStale(reportedAt) {
  if (!reportedAt) return true;

  const timestamp = new Date(reportedAt).getTime();

  return (
    !Number.isFinite(timestamp) ||
    Date.now() - timestamp > STALE_AFTER_MS
  );
}

// GET /api/bins/:binId/diagnostics
exports.getBinDiagnostics = async (req, res) => {
  try {
    const bin = await Bin.findOne({ binId: req.params.binId })
      .select("binId name status lastHeartbeat diagnostics")
      .lean();

    if (!bin) {
      return res.status(404).json({
        success: false,
        message: "Bin not found.",
      });
    }

    const diagnostics = bin.diagnostics || {};
    const stale = isStale(diagnostics.reportedAt);

    return res.json({
      success: true,
      data: {
        binId: bin.binId,
        name: bin.name,
        binStatus: bin.status || "offline",
        lastHeartbeat: bin.lastHeartbeat || null,
        overallStatus: stale
          ? "unknown"
          : diagnostics.overallStatus || "unknown",
        reportedAt: diagnostics.reportedAt || null,
        stale,
        components: diagnostics.components || {},
        alerts: diagnostics.alerts || [],
      },
    });
  } catch (error) {
    console.error("[Diagnostics GET]", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve diagnostics.",
    });
  }
};

// POST /api/bins/:binId/diagnostics
exports.updateBinDiagnostics = async (req, res) => {
  try {
    const binId = cleanText(req.params.binId, 80);

    if (!binId) {
      return res.status(400).json({
        success: false,
        message: "A valid binId is required.",
      });
    }

    const components = normalizeComponents(req.body?.components);

    if (!components) {
      return res.status(400).json({
        success: false,
        message: "Invalid components or component status.",
      });
    }

    const alerts = normalizeAlerts(req.body?.alerts);

    if (!alerts) {
      return res.status(400).json({
        success: false,
        message: "alerts must be an array.",
      });
    }

    const previous = await Bin.findOne({ binId })
      .select("binId diagnostics.components")
      .lean();

    if (!previous) {
      return res.status(404).json({
        success: false,
        message: "Bin not found.",
      });
    }

    const oldComponents = previous.diagnostics?.components || {};
    const overallStatus = calculateOverallStatus(components);
    const reportedAt = new Date();

    const updatedBin = await Bin.findOneAndUpdate(
      { binId },
      {
        $set: {
          "diagnostics.overallStatus": overallStatus,
          "diagnostics.reportedAt": reportedAt,
          "diagnostics.components": components,
          "diagnostics.alerts": alerts,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    ).select("binId diagnostics");

    if (!updatedBin) {
      return res.status(404).json({
        success: false,
        message: "Bin not found.",
      });
    }

    // Notify only on meaningful component status transitions.
    for (const key of COMPONENT_KEYS) {
      const before = oldComponents[key]?.status || "unknown";
      const after = components[key].status;

      if (before === after) continue;

      const enteringProblem = after === "warning" || after === "fault";
      const recovered =
        (before === "warning" || before === "fault") &&
        after === "working";

      if (!enteringProblem && !recovered) continue;

      try {
        await createNotification({
          title: recovered
            ? `SmartBin component recovered: ${key}`
            : `SmartBin component needs attention: ${key}`,
          message: `${binId}: ${components[key].message || after}`,
          type: "system",
          meta: {
            binId,
            component: key,
            previousStatus: before,
            status: after,
          },
          dedupe: `${binId}:${key}:${before}->${after}`,
        });
      } catch (notificationError) {
        // A notification failure must not discard the diagnostic report.
        console.error(
          "[Diagnostics notification]",
          notificationError.message
        );
      }
    }

    return res.json({
      success: true,
      message: "Diagnostics updated.",
      data: {
        binId,
        overallStatus,
        reportedAt,
        components,
        alerts,
      },
    });
  } catch (error) {
    console.error("[Diagnostics POST]", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save diagnostics.",
    });
  }
};
