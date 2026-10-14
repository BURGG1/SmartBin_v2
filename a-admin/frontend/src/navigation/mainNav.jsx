import {
    Home,
    Gift,
    TrendingUpDown,
    Trash2,
    Star,
    QrCode,
    User,
    Trophy,
} from "lucide-react";

import { Sidebar } from "./Sidebar";
import { MobileDrawer } from "./navDrawer";
import { BottomNav } from "./bottomNav";
import { useState } from "react";

const userMenu = [
    { name: "Dashboard", icon: TrendingUpDown, path: "/dashboard" },
    { name: "Household Information", icon: Home, path: "/householdInfo" },
    { name: "Waste bin Segregation", icon: Trash2, path: "/wastebin" },
    { name: "Bin Monitoring", icon: Trash2, path: "/binMonitoring" },
    { name: "Rewards and Rules", icon: Star, path: "/gamified" },
];

const adminMenu = [
    { name: "Dashboard", icon: TrendingUpDown, path: "/dashboard" },
    { name: "Household Information", icon: Home, path: "/householdInfo" },
    { name: "Waste bin Segregation", icon: Trash2, path: "/wastebin" },
    { name: "Bin Monitoring", icon: Trash2, path: "/binMonitoring" },
    { name: "Rewards and Rules", icon: Star, path: "/gamified" },
]

export default function NavigationShell() {
    const role = sessionStorage.getItem("role") || "user";
    const isAdmin = role === "admin";
    return (
        <>
            <Sidebar menu={isAdmin ? adminMenu : userMenu} />

            {isAdmin ? (
                <MobileDrawer menu={adminMenu} />
            ) : (
                <BottomNav menu={userMenu} />
            )}
        </>
    );
}
