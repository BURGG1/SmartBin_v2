// Shared by the mobile app and the web admin panel.
// Contains no type annotations, so you can save it as privacyConfig.ts (mobile)
// or privacyConfig.js (web) without changes.
//
// ⚠ Every [BRACKETED] value is a placeholder. Fill them in with your barangay's
// real details and have your DPO / legal adviser review the wording.
// Bump PRIVACY_NOTICE_VERSION whenever the text changes so you can prove
// which version each resident consented to.

export const PRIVACY_NOTICE_VERSION = "2026-10-26-v1";

export const CONTROLLER_NAME = "Barangay [NAME], [CITY/MUNICIPALITY] — Smart Waste Program";
export const DPO_NAME = "[Data Protection Officer's name]";
export const DPO_EMAIL = "[dpo@your-barangay.gov.ph]";
export const DPO_PHONE = "[contact number]";

export const PRIVACY_NOTICE = [
    {
        heading: "What we collect",
        body:
            "Full name, contact number, email address, home address (house number and purok/street), " +
            "number of family members, and your RFID card number. Birthday is optional; because it reveals your age, " +
            "it is treated as sensitive personal information.",
    },
    {
        heading: "Why we collect it",
        body:
            "To register your household in the Smart Waste Program, verify that you live in the barangay, " +
            "issue your RFID card and app account, send you account credentials and collection notices, " +
            "and produce barangay waste statistics. [EDIT to match your actual purposes.] " +
            "We do not use your data for any other purpose without asking you first.",
    },
    {
        heading: "Who can see it",
        body:
            "Only authorized barangay personnel who need it for the purposes above. " +
            "We do not sell your data. We disclose it to others only when required by law or with your consent. " +
            "[LIST any processors, e.g. hosting or email providers.]",
    },
    {
        heading: "How long we keep it",
        body:
            "For as long as your household is enrolled in the program, then [RETENTION PERIOD — e.g. 2 years] " +
            "unless a law requires longer. After that it is securely deleted or anonymized.",
    },
    {
        heading: "How we protect it",
        body:
            "Data is sent over encrypted connections, stored with access limited to authorized staff, " +
            "and activity on the admin system is logged.",
    },
    {
        heading: "Your rights under the Data Privacy Act (RA 10173)",
        body:
            "You have the right to be informed, to access your data, to correct it, to object to its processing, " +
            "to request its erasure or blocking, to data portability, to claim damages for unlawful use, and to " +
            "withdraw your consent at any time (withdrawal does not affect processing already done, and may mean " +
            "we can no longer provide the service). You may also file a complaint with the National Privacy " +
            "Commission (privacy.gov.ph).",
    },
    {
        heading: "Contact our Data Protection Officer",
        body: `${DPO_NAME} — ${DPO_EMAIL} — ${DPO_PHONE}`,
    },
];

// One-line consent statements shown next to the checkboxes.
export const CONSENT_TEXT =
    "I have read the Privacy Notice and I consent to the collection and use of my personal information " +
    "for the purposes stated in it.";

export const SENSITIVE_CONSENT_TEXT =
    "I specifically consent to the processing of my birthday (which reveals my age, a sensitive personal " +
    "information) for the purposes stated in the Privacy Notice.";

export const STAFF_CONSENT_TEXT =
    "The resident was given the Privacy Notice and has freely consented to the collection and use of their " +
    "personal information for the purposes stated in it. Their signed consent form is on file.";