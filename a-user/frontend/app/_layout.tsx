import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { Stack, router, useRootNavigationState, useSegments } from "expo-router";
import { TermsProvider, useTerms } from "./termContext";
import "./globals.css";

function Gate() {
  const { termsAccepted, checkingTerms } = useTerms();
  const navigationState = useRootNavigationState();
  const segments = useSegments();

  useEffect(() => {
    if (checkingTerms || !navigationState?.key) return;

    const onTermsScreen = segments[0] === "terms_condition";

    if (!termsAccepted && !onTermsScreen) {
      router.replace("/terms_condition");
    }
  }, [checkingTerms, termsAccepted, navigationState?.key, segments]);

  if (checkingTerms) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="terms_condition" options={{ headerShown: false }} />
      <Stack.Screen name="ScanScreen" options={{ headerShown: false }} />
      <Stack.Screen name="counterInfo" options={{ headerShown: false }} />
      <Stack.Screen name="(userTabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(collectorTabs)" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <TermsProvider>
      <Gate />
    </TermsProvider>
  );
}