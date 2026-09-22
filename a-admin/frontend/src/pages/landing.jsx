import { useRef } from "react";
import Header from "../components/Header";
import LandingFooter from "../components/LandingFooter";
import Hero from "../components/hero";
import AboutSection from "../components/AboutSection";
import Maintenance from "../components/MaintenanceSection";
import CTAsection from "../components/CTAsection";

export default function Landing() {
    const aboutRef = useRef(null);
    const maintenanceRef = useRef(null);
    const ctaRef = useRef(null);


    const scrollToAbout = () => {
        aboutRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const scrollToMaintenance = () => {
        maintenanceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const scrollToCTA = () => {
        ctaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    return (
        <>
            <Header
                onAboutClick={scrollToAbout}
                onMaintenanceClick={scrollToMaintenance}
            />

            <Hero learnMore={scrollToCTA} />

            <div ref={maintenanceRef} className="scroll-mt-20">
                <Maintenance scrollDown={scrollToAbout} />
            </div>

            <div ref={aboutRef} className="scroll-mt-20">
                <AboutSection scrollDown={scrollToCTA} />
            </div>

            <div ref={ctaRef} className="scroll-mt-20">
                <CTAsection />
            </div>

            <LandingFooter />
        </>
    );
}