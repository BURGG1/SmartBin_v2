import { Stack } from "expo-router";
import './globals.css'

export default function RootLayout() {
  return <Stack>
    <Stack.Screen
      name="index"
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="counterInfopage"
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="(userTabs)"
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="(collectorTabs)"
      options={{ headerShown: false }}
    />

  </Stack>;
}
