import { useState, useEffect, useRef } from "react";
import {
    UserPlus, QrCode, Trash2, Gift, Play, ArrowRight, ChevronDown
} from "lucide-react";

import recyc1 from "../resources/recyc1.jpg";
import recycVid from "../resources/smartbinC.mp4";

const steps = [
    {
        num: 1,
        icon: <UserPlus className="w-7 h-7" />,
        title: "Register Household",
        desc: "Sign up your household in the SmartBin system through your barangay office.",
    },
    {
        num: 2,
        icon: <QrCode className="w-7 h-7" />,
        title: "Receive QR Code",
        desc: "Get your unique QR code that identifies your household for waste tracking.",
    },
    {
        num: 3,
        icon: <Trash2 className="w-7 h-7" />,
        title: "Dispose Waste Properly",
        desc: "Scan your QR code and segregate waste correctly into the smart bins.",
    },
    {
        num: 4,
        icon: <Gift className="w-7 h-7" />,
        title: "Earn Rewards",
        desc: "Collect points for proper disposal and redeem them for exciting rewards.",
    },
];

const videos = [
    {
        id: 0,
        title: "System Demonstration",
        desc: "Watch how residents interact with SmartBin using QR technology.",
        bg: recyc1,
        video: recycVid,
    },
    {
        id: 1,
        title: "Maintenance & Operations",
        desc: "Learn how barangay personnel manage and maintain the SmartBin system.",
        bg: recyc1,
        video: recycVid,
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
            {/* HOW IT WORKS SECTION */}
            <section className="bg-gradient-to-b from-emerald-50/60 via-white to-white py-16 sm:py-24">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
                    <Reveal className="text-center mb-16">
                        <span className="inline-block text-xs font-bold tracking-widest text-emerald-600 uppercase mb-3">
                            The Process
                        </span>
                        <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900">
                            How SmartBin Works
                        </h2>
                        <p className="text-gray-500 mt-3 max-w-xl mx-auto">
                            Four simple steps from sign-up to rewards — designed to make
                            proper waste disposal effortless for every household.
                        </p>
                    </Reveal>

                    <div className="relative">
                        {/* Connecting line (desktop only) */}
                        <div className="hidden lg:block absolute top-[3.25rem] left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-200 to-transparent" />

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
                            {steps.map((step, i) => (
                                <Reveal key={step.num} delay={i * 120}>
                                    <div className="group relative flex flex-col items-center text-center bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-6 pt-10 h-full">
                                        {/* Step number bubble */}
                                        <div className="absolute -top-5 left-1/2 -translate-x-1/2 w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full flex items-center justify-center text-white font-bold text-base shadow-md ring-4 ring-white">
                                            {step.num}
                                        </div>

                                        {/* Icon */}
                                        <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-5 mt-1 group-hover:bg-emerald-600 group-hover:text-white transition-colors duration-300">
                                            {step.icon}
                                        </div>

                                        <h3 className="font-bold text-gray-900 mb-2 text-base">{step.title}</h3>
                                        <p className="text-gray-500 text-sm leading-relaxed">{step.desc}</p>

                                        {i < steps.length - 1 && (
                                            <ArrowRight className="hidden lg:block w-5 h-5 text-emerald-200 absolute -right-7 top-14" />
                                        )}
                                    </div>
                                </Reveal>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Scroll-down cue: jumps to the "SmartBin in Action" video section below, not past it */}
                <div className="pt-12 sm:pt-16 flex justify-center">
                    <button
                        onClick={scrollToVideos}
                        className="group flex flex-col items-center gap-2 cursor-pointer"
                        aria-label="Scroll to SmartBin in Action"
                    >
                        <span className="w-10 h-10 rounded-full border border-gray-300 group-hover:border-green-500 flex items-center justify-center animate-bounce transition-colors">
                            <ChevronDown className="w-5 h-5 text-gray-500 group-hover:text-green-500" />
                        </span>
                    </button>
                </div>
            </section>

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