import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

export default function TabLayout() {
    return (

        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: "#16a34a",
            }}
        >
            <Tabs.Screen
                name="home"
                options={{
                    title: "Home",
                    tabBarIcon: ({ color, size }) => (
                        <Feather name="home" size={size} color={color} />
                    ),
                }}
            />


            <Tabs.Screen
                name="reward"
                options={{
                    title: "Reward",
                    tabBarIcon: ({ color, size }) => (
                        <Feather name="gift" size={size} color={color} />
                    ),
                }}
            />

            <Tabs.Screen
                name="leaderboard"
                options={{
                    title: "Leaderboard",
                    tabBarIcon: ({ color, size }) => (
                        <Feather name="bar-chart-2" size={size} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="rules"
                options={{
                    title: "Activities",
                    tabBarIcon: ({ color, size }) => (
                        <Feather name="book" size={size} color={color} />
                    ),
                }}
            />

            <Tabs.Screen
                name="profile"
                options={{
                    title: "Profile",
                    tabBarIcon: ({ color, size }) => (
                        <Feather name="user" size={size} color={color} />
                    ),
                }}
            />
        </Tabs>

    );
}