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
    { name: "Home", icon: Home, path: "/home" },
    { name: "Rewards", icon: Gift, path: "/rewards" },
    { name: "QR-Code", icon: QrCode, path: "/qrcode" },
    { name: "Leaderboard", icon: Trophy, path: "/leaderboard" },
    { name: "My Profile", icon: User, path: "/home-page" },
];

const adminMenu = [
    { name: "Dashboard", icon: TrendingUpDown, path: "/dashboard" },
    { name: "Household Information", icon: Home, path: "/householdInfo" },
    { name: "Waste bin Segregation", icon: Trash2, path: "/wastebin" },
    { name: "Bin Monitoring", icon: Trash2, path: "/binMonitoring" },
    { name: "Reward Management", icon: Star, path: "/gamified" },
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
