// store/householdStore.ts
import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "@/config";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Points {
    total: number;
    thisMonth: number;
}

interface Streak {
    currentStreak: number;
    lastDisposalDate: string | null;
}

interface Address {
    houseNo?: string;
    street?: string;
}

export interface Household {
    _id: string;
    fullname: string;
    rfid: string;
    email?: string;
    contactNumber?: string;
    birthday?: string;
    familyMember?: number;
    address?: Address;
    points: Points;
    streak: Streak;
    violation: number;
    isActive: boolean;
    createdAt: string;
}

interface HouseholdStore {
    household: Household | null;
    setHousehold: (h: Household | null) => void;
    fetchHousehold: () => Promise<void>;
    clearHousehold: () => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────
const useHouseholdStore = create<HouseholdStore>((set) => ({
    household: null,

    setHousehold: (h) => set({ household: h }),

    clearHousehold: () => set({ household: null }),

    fetchHousehold: async () => {
        try {
            const token = await AsyncStorage.getItem("token");
            if (!token) return;

            const res  = await fetch(`${API_BASE}/api/auth/me`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();

            if (data.success && data.data) {
                set({ household: data.data });
            }
        } catch (err) {
            console.error("[householdStore] fetchHousehold failed:", err);
        }
    },
}));

// Named exports for use in components
export const useHousehold    = () => useHouseholdStore((s) => s.household);
export const fetchHousehold  = () => useHouseholdStore.getState().fetchHousehold();
export const clearHousehold  = () => useHouseholdStore.getState().clearHousehold();
export const setHousehold    = (h: Household | null) => useHouseholdStore.getState().setHousehold(h);

// ✅ Required default export so Expo Router doesn't treat this as a broken route
export default useHouseholdStore;