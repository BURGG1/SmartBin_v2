
require("dotenv").config();

const { sendTextBeeSms } = require("./config/sms");

const testSms = async () => {
  try {
    // Replace with the recipient's Philippine mobile number
    const recipient = "09952741462";

    const result = await sendTextBeeSms({
      to: recipient,
      message:
        "SmartBin TextBee integration test. Please ignore this test message.",
    });

    console.log("\nTextBee API response:");
    console.log(JSON.stringify(result, null, 2));

    console.log(
      "\nTextBee accepted the request. Check the API response and verify delivery on your phone."
    );
  } catch (error) {
    console.error("\nTextBee test failed:");
    console.error(error.message);
    process.exitCode = 1;
  }
};

testSms();
