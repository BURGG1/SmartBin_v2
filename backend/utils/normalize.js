// Canonical RFID format: uppercase, hyphen-separated hex pairs, no stray whitespace.
// e.g. " 77-79-86-25 " / "77:79:86:25" / "7779-8625" all normalize differently —
// this specifically expects the MFRC522 dash-separated hex format your ESP32 sends.
const normalizeRfid = (input) => {
  if (!input || typeof input !== "string") return null;
  return input.trim().toUpperCase();
};

module.exports = { normalizeRfid };