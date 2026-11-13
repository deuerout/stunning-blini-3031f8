import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { theme } from "@/theme";

export default function RootLayout() {
  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.ink },
          headerTintColor: theme.colors.parchment,
          headerTitleStyle: { fontWeight: "600" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Solomon" }} />
      </Stack>
      <StatusBar style="light" />
    </>
  );
}
