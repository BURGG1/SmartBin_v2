
require("dotenv").config();

const { sendUniSms } = require("./config/sms");

const testSms = async () => {
  try {
    const recipient = "09952741462"; // REPLACE with your own number

    const result = await sendUniSms({
      to: recipient,
      message: "SmartBin UniSMS integration test. Please ignore this test message.",
      metadata: {
        purpose: "smartbin_integration_test",
      },
    });

    console.log("\nUniSMS API response:");
    console.log(JSON.stringify(result, null, 2));

    console.log(
      "\nRequest accepted. Check the returned status and verify delivery on your phone."
    );
  } catch (error) {
    console.error("\nUniSMS test failed:");
    console.error(error.message);
    process.exitCode = 1;
  }
};

testSms();
