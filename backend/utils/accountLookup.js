
const Admin = require("../models/Admin");
const Collector = require("../models/Collector");
const Household = require("../models/Household");

// Order mirrors the precedence used in login():
// Admin, then Collector, then Household.
const ACCOUNT_LOOKUPS = [
  { role: "admin", Model: Admin },
  { role: "collector", Model: Collector },
  { role: "household", Model: Household },
];

/**
 * Finds the first active account matching normalizedEmail.
 * Returns { user, role, Model } or null.
 */
async function findAccountByEmail(normalizedEmail) {
  for (const { role, Model } of ACCOUNT_LOOKUPS) {
    const user = await Model.findOne({
      email: normalizedEmail,
      isActive: true,
    });

    if (user) {
      return { user, role, Model };
    }
  }

  return null;
}

module.exports = {
  findAccountByEmail,
  ACCOUNT_LOOKUPS,
};
