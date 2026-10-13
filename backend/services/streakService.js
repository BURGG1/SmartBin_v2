
const mongoose = require("mongoose");
const Household = require("../models/Household");
const Rule = require("../models/Rule");
const PointLog = require("../models/PointLog");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getUtcDay(date) {
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
}

function getUtcDayKey(date) {
  return date.toISOString().slice(0, 10);
}

function getUtcMonthKey(date) {
  return date.toISOString().slice(0, 7);
}

function getUtcWeekKey(date) {
  const d = new Date(getUtcDay(date));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    (((d - yearStart) / MS_PER_DAY) + 1) / 7
  );

  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// Supports "30" or "50-200".
// A range produces a random whole-number award within the range.
function parsePoints(value) {
  const text = String(value ?? "").trim();

  if (/^\d+$/.test(text)) {
    const points = Number(text);
    return Number.isSafeInteger(points) && points > 0
      ? points
      : null;
  }

  const match = text.match(/^(\d+)\s*-\s*(\d+)$/);

  if (!match) return null;

  const min = Number(match[1]);
  const max = Number(match[2]);

  if (
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max) ||
    min < 1 ||
    max < min
  ) {
    return null;
  }

  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getQuantityForRule(rule, quantities) {
  switch (rule.freq) {
    case "per kilo":
      return quantities.kilos;

    case "per item":
      return quantities.items;

    case "per brick":
      return quantities.bricks;

    default:
      return 1;
  }
}

function makeEventKey(householdId, ruleId, suffix) {
  return `${householdId}:${ruleId}:${suffix}`;
}

async function awardRule({
  household,
  rule,
  points,
  quantity,
  eventKey,
  reason,
}) {
  if (!Number.isSafeInteger(points) || points <= 0) {
    return null;
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  const totalAward = Math.round(points * quantity);

  if (
    !Number.isSafeInteger(totalAward) ||
    totalAward <= 0
  ) {
    return null;
  }

  // The unique eventKey prevents the same rule event from being
  // logged twice, including concurrent attempts.
  try {
    await PointLog.create({
      household: household._id,
      rule: rule._id,
      points: totalAward,
      quantity,
      reason,
      eventKey,
    });
  } catch (error) {
    if (error.code === 11000) {
      return null; // Already awarded for this event.
    }

    throw error;
  }

  household.points ??= { total: 0, thisMonth: 0 };
  household.points.total ??= 0;
  household.points.thisMonth ??= 0;

  household.points.total += totalAward;
  household.points.thisMonth += totalAward;

  await household.save();

  return {
    ruleId: rule._id,
    ruleName: rule.name,
    points: totalAward,
    quantity,
    reason,
  };
}

/**
 * Call after a successful disposal has been recorded.
 *
 * context:
 * {
 *   disposalId: ObjectId,
 *   kilos?: number,
 *   items?: number,
 *   bricks?: number
 * }
 */
async function checkAndAwardPoints(householdOrId, context = {}) {
  const householdId =
    householdOrId?._id ?? householdOrId;

  if (!mongoose.isValidObjectId(householdId)) {
    throw new Error("A valid household ID is required.");
  }

  if (!context.disposalId ||
      !mongoose.isValidObjectId(context.disposalId)) {
    throw new Error("A valid disposal ID is required.");
  }

  const household = await Household.findById(householdId);

  if (!household) {
    throw new Error("Household not found.");
  }

  if (!household.isActive) {
    throw new Error("Cannot award points to an inactive household.");
  }

  const now = new Date();
  const todayKey = getUtcDayKey(now);
  const previousDate = household.streak?.lastDisposalDate;

  household.points ??= { total: 0, thisMonth: 0 };
  household.points.total ??= 0;
  household.points.thisMonth ??= 0;

  household.streak ??= {};
  household.streak.currentStreak ??= 0;
  household.streak.awardedStreaks ??= [];

  let currentStreak = household.streak.currentStreak;
  let isNewDisposalDay = false;

  if (!previousDate) {
    currentStreak = 1;
    isNewDisposalDay = true;
  } else {
    const previousDay = getUtcDay(new Date(previousDate));
    const currentDay = getUtcDay(now);
    const diffDays = Math.round(
      (currentDay - previousDay) / MS_PER_DAY
    );

    if (diffDays === 0) {
      // Another disposal today: keep the current streak.
    } else if (diffDays === 1) {
      currentStreak += 1;
      isNewDisposalDay = true;
    } else {
      currentStreak = 1;
      isNewDisposalDay = true;
      household.streak.awardedStreaks = [];
    }
  }

  if (isNewDisposalDay) {
    household.streak.currentStreak = currentStreak;
    household.streak.lastDisposalDate = now;
    await household.save();
  }

  const rules = await Rule.find({ auto: true }).lean();
  const awards = [];

  const quantities = {
    kilos: Number(context.kilos),
    items: Number(context.items),
    bricks: Number(context.bricks),
  };

  for (const rule of rules) {
    const basePoints = parsePoints(rule.points);

    if (basePoints === null) {
      console.warn(
        `[Points] Skipping rule "${rule.name}": invalid points value.`
      );
      continue;
    }

    let eventSuffix;
    let quantity = 1;
    let reason = rule.name;

    switch (rule.freq) {
      case "Per Collection":
        eventSuffix = `disposal:${context.disposalId}`;
        reason = `${rule.name} - collection`;
        break;

      case "per kilo":
      case "per item":
      case "per brick": {
        quantity = getQuantityForRule(rule, quantities);

        // Do not guess a missing weight or item count.
        if (!Number.isFinite(quantity) || quantity <= 0) {
          continue;
        }

        eventSuffix = `disposal:${context.disposalId}`;
        reason = `${rule.name} - quantity ${quantity}`;
        break;
      }

      case "Daily":
        if (household.streak.lastDailyAward &&
            getUtcDayKey(new Date(household.streak.lastDailyAward)) === todayKey) {
          // Legacy marker is respected, but event keys below are
          // the primary per-rule duplicate protection.
        }

        eventSuffix = `daily:${todayKey}`;
        reason = `${rule.name} - daily reward`;
        break;

      case "Weekly":
        if (currentStreak < 7) continue;

        eventSuffix = `weekly:${getUtcWeekKey(now)}`;
        reason = `${rule.name} - weekly reward`;
        break;

      case "Monthly":
        if (currentStreak < 30) continue;

        eventSuffix = `monthly:${getUtcMonthKey(now)}`;
        reason = `${rule.name} - monthly reward`;
        break;

      case "per streak": {
        const threshold = Number(rule.streakDays);

        if (
          !Number.isSafeInteger(threshold) ||
          threshold < 1 ||
          currentStreak < threshold
        ) {
          continue;
        }

        // Each rule has its own milestone key. Two rules with the
        // same streakDays will not block each other.
        eventSuffix = `streak:${threshold}`;
        reason = `${rule.name} - ${threshold}-day streak`;
        break;
      }

      default:
        // Unknown frequency: do not award it silently.
        continue;
    }

    const eventKey = makeEventKey(
      household._id.toString(),
      rule._id.toString(),
      eventSuffix
    );

    const award = await awardRule({
      household,
      rule,
      points: basePoints,
      quantity,
      eventKey,
      reason,
    });

    if (award) awards.push(award);

    // Keep legacy fields populated for compatibility with existing UI.
    if (award && rule.freq === "Daily") {
      household.streak.lastDailyAward = now;
    } else if (award && rule.freq === "Weekly") {
      household.streak.lastWeeklyAward = now;
    } else if (award && rule.freq === "Monthly") {
      household.streak.lastMonthlyAward = now;
    } else if (award && rule.freq === "per streak") {
      if (!household.streak.awardedStreaks.includes(rule.streakDays)) {
        household.streak.awardedStreaks.push(rule.streakDays);
      }
    }
  }

  await household.save();

  return {
    currentStreak,
    awards,
    totalBonusPoints: awards.reduce(
      (sum, award) => sum + award.points,
      0
    ),
  };
}

module.exports = { checkAndAwardPoints };
