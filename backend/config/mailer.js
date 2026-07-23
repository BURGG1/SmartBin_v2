const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

const sendPasswordEmail = async ({ to, fullname, password }) => {
  await transporter.sendMail({
    from: `"Smart Waste Management" <${process.env.GMAIL_USER}>`,
    to,
    subject: "Your Household Account Credentials",
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <h2 style="color: #16a34a;">Welcome, ${fullname}!</h2>
        <p>Your household has been successfully registered in the <strong>Smart Waste Management System</strong>.</p>
        <p>Here are your login credentials:</p>
        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p style="margin: 0;"><strong>Email:</strong> ${to}</p>
          <p style="margin: 8px 0 0;"><strong>Password:</strong> <span style="font-size: 18px; color: #16a34a; font-weight: bold;">${password}</span></p>
        </div>
        <p style="color: #6b7280; font-size: 13px;">Please keep your password safe. You can change it after logging in.</p>
      </div>
    `,
  });
};

// New: reset-code email, reusing the same transporter/config as above.
const sendResetCodeEmail = async ({ to, code }) => {
  const expiryMinutes = process.env.RESET_CODE_EXPIRY_MINUTES || 10;

  await transporter.sendMail({
    from: `"Smart Waste Management" <${process.env.GMAIL_USER}>`,
    to,
    subject: "Your password reset code",
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <h2 style="color: #16a34a;">Reset your password</h2>
        <p>Use the code below to reset your password. It expires in ${expiryMinutes} minutes.</p>
        <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; background: #f3f4f6; padding: 16px; text-align: center; border-radius: 8px;">
          ${code}
        </p>
        <p style="color: #6b7280; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
};

module.exports = { transporter, sendPasswordEmail, sendResetCodeEmail };