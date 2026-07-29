const Household = require("../models/Household");
const Rule = require("../models/Rule");
const PointLog = require("../models/PointLog");

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const dayOnly = (d) => (d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null);

// Called every time a household disposes at a bin
const checkAndAwardPoints = async (household) => {
  const now = new Date();
  const today = dayOnly(now);

  // ── Defensive init ──────────────────────────────────────────────────────
  // Handles legacy/partial documents where these subfields never got set
  // (this is very likely why "per streak" rules silently never fired).
  if (!household.streak) household.streak = {};
  if (typeof household.streak.currentStreak !== "number") household.streak.currentStreak = 0;
  if (!Array.isArray(household.streak.awardedStreaks)) household.streak.awardedStreaks = [];
  if (!household.points) household.points = { total: 0, thisMonth: 0 };
  if (typeof household.points.total !== "number") household.points.total = 0;
  if (typeof household.points.thisMonth !== "number") household.points.thisMonth = 0;

  const lastDate = dayOnly(household.streak.lastDisposalDate);
  const awarded = [];

  if (!lastDate) {
    // First ever disposal
    household.streak.currentStreak = 1;
  } else {
    const diffDays = Math.floor((today - lastDate) / MS_PER_DAY);

    if (diffDays === 0) {
      // Already disposed today — streak & auto-rules already evaluated
      // earlier today, don't re-run or double-award.
      return awarded;
    } else if (diffDays === 1) {
      household.streak.currentStreak += 1;
    } else {
      // Streak broken — reset
      household.streak.currentStreak = 1;
      household.streak.awardedStreaks = [];
    }
  }

  household.streak.lastDisposalDate = now;
  const currentStreak = household.streak.currentStreak;

  const autoRules = await Rule.find({ auto: true });

  for (const rule of autoRules) {
    try {
      const points = parseInt(rule.points, 10) || 0;

      // ── Per Streak rules ────────────────────────────────────────────────
      if (rule.freq === "per streak" && rule.streakDays) {
        const alreadyAwarded = household.streak.awardedStreaks.includes(rule.streakDays);

        if (currentStreak >= rule.streakDays && !alreadyAwarded) {
          household.points.total += points;
          household.points.thisMonth += points;
          household.streak.awardedStreaks.push(rule.streakDays);

          await PointLog.create({
            household: household._id,
            rule: rule._id,
            points,
            reason: `${rule.streakDays}-day streak achieved — ${rule.name}`,
          });

          awarded.push({ rule: rule.name, points, reason: `${rule.streakDays}-day streak` });
        }
      }

      // ── Daily rules (award every calendar day a disposal happens) ───────
      if (rule.freq === "Daily") {
        const lastDaily = dayOnly(household.streak.lastDailyAward);
        const alreadyAwardedToday = lastDaily && lastDaily.getTime() === today.getTime();

        if (!alreadyAwardedToday) {
          household.points.total += points;
          household.points.thisMonth += points;
          household.streak.lastDailyAward = now;

          await PointLog.create({
            household: household._id,
            rule: rule._id,
            points,
            reason: `Daily disposal reward — ${rule.name}`,
          });

          awarded.push({ rule: rule.name, points, reason: "Daily reward" });
        }
      }

      // ── Weekly rules (every 7 days) ──────────────────────────────────────
      if (rule.freq === "Weekly") {
        const lastWeekly = dayOnly(household.streak.lastWeeklyAward);
        const daysSinceWeekly = lastWeekly ? Math.floor((today - lastWeekly) / MS_PER_DAY) : Infinity;

        if (currentStreak >= 7 && daysSinceWeekly >= 7) {
          household.points.total += points;
          household.points.thisMonth += points;
          household.streak.lastWeeklyAward = now;

          await PointLog.create({
            household: household._id,
            rule: rule._id,
            points,
            reason: `Weekly consistency streak — ${rule.name}`,
          });

          awarded.push({ rule: rule.name, points, reason: "Weekly streak" });
        }
      }

      // ── Monthly rules (every 30 days) ────────────────────────────────────
      if (rule.freq === "Monthly") {
        const lastMonthly = dayOnly(household.streak.lastMonthlyAward);
        const daysSinceMonthly = lastMonthly ? Math.floor((today - lastMonthly) / MS_PER_DAY) : Infinity;

        if (currentStreak >= 30 && daysSinceMonthly >= 30) {
          household.points.total += points;
          household.points.thisMonth += points;
          household.streak.lastMonthlyAward = now;

          await PointLog.create({
            household: household._id,
            rule: rule._id,
            points,
            reason: `Monthly consistency streak — ${rule.name}`,
          });

          awarded.push({ rule: rule.name, points, reason: "Monthly streak" });
        }
      }
    } catch (err) {
      // A bad/malformed rule shouldn't take down the whole disposal flow.
      console.error(`[StreakService] Failed evaluating rule "${rule.name}" (${rule._id}):`, err.message);
    }
  }

  await household.save();
  return awarded;
};

module.exports = { checkAndAwardPoints };