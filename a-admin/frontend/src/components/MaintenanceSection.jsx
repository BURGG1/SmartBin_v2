import { useState, useEffect, useRef } from "react";
import {
    Play
} from "lucide-react";

import maintenanceTN from "../resources/maintenanceTN.png";
import HowToUseTN from "../resources/HowToUseTN.png";
import howtouse from "../resources/howtouse.mp4";
import smartbinMaintenance from "../resources/SmartBin_maintenance.mp4";

const videos = [
    {
        id: 0,
        title: "System Demonstration",
        desc: "Watch how residents interact with SmartBin using QR technology.",
        bg: HowToUseTN,
        video: howtouse,
    },
    {
        id: 1,
        title: "Maintenance & Operations",
        desc: "Learn how barangay personnel manage and maintain the SmartBin system.",
        bg: maintenanceTN,
        video: smartbinMaintenance,
    },
];

function useInView(options = {}) {
    const ref = useRef(null);
    const [inView, setInView] = useState(false);

    useEffect(() => {
        const node = ref.current;
        if (!node) return;

        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setInView(true);
                observer.disconnect();
            }
        }, { threshold: 0.15, rootMargin: "0px 0px -80px 0px", ...options });

        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    return [ref, inView];
}

function Reveal({ children, delay = 0, direction = "up", className = "" }) {
    const [ref, inView] = useInView();

    const offset = {
        up: "translate-y-10",
        left: "-translate-x-10",
        right: "translate-x-10",
    }[direction];

    return (
        <div
            ref={ref}
            className={`transition-all ease-out duration-700 ${inView ? "opacity-100 translate-x-0 translate-y-0" : `opacity-0 ${offset}`
                } ${className}`}
            style={{ transitionDelay: inView ? `${delay}ms` : "0ms" }}
        >
            {children}
        </div>
    );
}

function PlayButton() {
    return (
        <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform duration-300">
                <Play className="w-6 h-6 text-emerald-600 ml-1" fill="currentColor" />
            </div>
        </div>
    );
}

export default function Maintenance({ scrollDown }) {
    const videoSectionRef = useRef(null);

    const scrollToVideos = () => {
        videoSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const openVideo = (videoSrc) => {
        window.open(videoSrc, "_blank", "noopener,noreferrer");
    };

    return (
        <>
           

            {/* VIDEO SECTION */}
            <section
                ref={videoSectionRef}
                className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 scroll-mt-20"
            >
                <Reveal className="text-center mb-12">
                    <span className="inline-block text-xs font-bold tracking-widest text-emerald-600 uppercase mb-3">
                        Watch &amp; Learn
                    </span>
                    <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900">
                        See SmartBin in Action
                    </h2>
                </Reveal>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
                    {videos.map((v, i) => (
                        <Reveal key={v.id} delay={i * 150} direction={i % 2 === 0 ? "left" : "right"}>
                            <div
                                className="group rounded-2xl overflow-hidden shadow-md hover:shadow-xl border border-gray-100 bg-white cursor-pointer transition-shadow duration-300"
                                onClick={() => openVideo(v.video)}
                                role="button"
                                aria-label={`Play ${v.title} in a new tab`}
                            >
                                {/* Thumbnail */}
                                <div className="relative h-56 sm:h-72 overflow-hidden">
                                    <img
                                        src={v.bg}
                                        alt={v.title}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-70 group-hover:opacity-80 transition-opacity duration-300" />
                                    <PlayButton />
                                </div>

                                {/* Caption */}
                                <div className="p-5">
                                    <h3 className="font-bold text-gray-900 mb-1">{v.title}</h3>
                                    <p className="text-gray-500 text-sm">{v.desc}</p>
                                </div>
                            </div>
                        </Reveal>
                    ))}
                </div>
            </section>
        </>
    );
}