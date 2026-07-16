const Admin = require("../models/Admin");
const Collector = require("../models/Collector");
const Household = require("../models/Household");


// Order mirrors the precedence used in login(): Admin, then Collector, then
// Household. Keeping the same precedence avoids ambiguity if the same email
// somehow ended up in more than one collection.
const ACCOUNT_LOOKUPS = [
  { role: "admin", Model: Admin },
  { role: "collector", Model: Collector },
  { role: "household", Model: Household },
];

/**
 * Finds the first active account matching normalizedEmail across Admin,
 * Collector, and Household, in that order.
 * Returns { account, role, Model } or null.
 */
async function findAccountByEmail(normalizedEmail) {
  for (const { role, Model } of ACCOUNT_LOOKUPS) {
    const account = await Model.findOne({ email: normalizedEmail, isActive: true });
    if (account) return { account, role, Model };
  }
  return null;
}

module.exports = { findAccountByEmail, ACCOUNT_LOOKUPS };