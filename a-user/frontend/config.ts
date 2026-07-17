import Constants from "expo-constants";

const localIP = Constants.expoConfig?.hostUri?.split(":")[0];

if (!localIP) {
  console.warn("Could not detect dev machine IP — falling back to localhost, which won't work on a physical device.");
}

export const API_BASE = `http://${localIP || "localhost"}:5000` || "https://smartbin-mc2d.onrender.com";