const mongoose = require("mongoose");

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 10000,  // give up selecting a server after 10s
            socketTimeoutMS:          45000,  // close idle sockets after 45s
            connectTimeoutMS:         10000,  // initial connection timeout
            maxPoolSize:              10,     // max simultaneous connections
            retryWrites:              true,   // retry failed writes automatically
        });

        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

        // ── Connection event listeners ─────────────────────────────────────────
        mongoose.connection.on("disconnected", () => {
            console.warn("⚠️  MongoDB disconnected — Mongoose will auto-reconnect...");
        });

        mongoose.connection.on("reconnected", () => {
            console.log("✅ MongoDB reconnected.");
        });

        mongoose.connection.on("error", (err) => {
            console.error("❌ MongoDB error:", err.message);
        });

    } catch (error) {
        console.error(`❌ MongoDB connection error: ${error.message}`);
        process.exit(1);
    }
};

module.exports = connectDB;