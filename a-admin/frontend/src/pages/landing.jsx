import { useRef } from "react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import Hero from "../components/hero";
import CTAsection from "../components/CTAsection";
import LandingFooter from "../components/LandingFooter";
import Maintenance from "../components/MaintenanceSection";
import AboutSection from "../components/AboutSection";

export default function Landing() {

    const aboutRef = useRef(null);
    const maintenanceRef = useRef(null);

    const scrollToAbout = () => {
        aboutRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    const scrollToMaintenance = () => {
        maintenanceRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    return (
        <>
            <Hero learnMore={scrollToAbout} />
            <div ref={aboutRef}>
                <AboutSection scrollDown={scrollToMaintenance} />
            </div>
            <div ref={maintenanceRef}>
                <Maintenance />
            </div>
            <CTAsection />
            <LandingFooter />
        </>
    );
}