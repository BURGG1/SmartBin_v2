import Constants from "expo-constants";

const localIP = Constants.expoConfig?.hostUri?.split(":")[0];

if (!localIP) {
  console.warn("Could not detect dev machine IP — falling back to localhost, which won't work on a physical device.");
}

export const API_BASE = localIP ? `http://${localIP}:5000` : "https://backend-smartbin.onrender.com";