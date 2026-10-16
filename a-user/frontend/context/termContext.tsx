import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Bump this if you ever publish an updated version of the terms and want
// users who accepted the old version to be re-prompted.
export const TERMS_VERSION = "2026-10";
export const TERMS_STORAGE_KEY = "termsAccepted";

type TermsContextValue = {
  termsAccepted: boolean;
  checkingTerms: boolean;
  markAccepted: () => Promise<void>;
};

const TermsContext = createContext<TermsContextValue | undefined>(undefined);

export function TermsProvider({ children }: { children: React.ReactNode }) {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [checkingTerms, setCheckingTerms] = useState(true);

  // Read the stored flag once, on app launch.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(TERMS_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          setTermsAccepted(
            parsed?.accepted === true && parsed?.version === TERMS_VERSION
          );
        }
      } catch (err) {
        console.error("Failed to read terms acceptance:", err);
      } finally {
        setCheckingTerms(false);
      }
    })();
  }, []);

  // Called by the terms screen after the user taps "I Agree". This is the
  // piece that was missing before: it updates the SAME state that
  // _layout.tsx's redirect effect reads, so there's no stale-state bounce
  // back to the terms screen after navigating to "/".
  const markAccepted = async () => {
    await AsyncStorage.setItem(
      TERMS_STORAGE_KEY,
      JSON.stringify({ accepted: true, version: TERMS_VERSION })
    );
    setTermsAccepted(true);
  };

  return (
    <TermsContext.Provider value={{ termsAccepted, checkingTerms, markAccepted }}>
      {children}
    </TermsContext.Provider>
  );
}

export function useTerms() {
  const ctx = useContext(TermsContext);
  if (!ctx) {
    throw new Error("useTerms must be used within a TermsProvider");
  }
  return ctx;
}