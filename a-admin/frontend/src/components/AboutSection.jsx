import { useState, useEffect, useRef } from "react";
import {
    Leaf, Target, Globe, Lightbulb, HandshakeIcon, Sparkles, Users,
    ChevronDown, UserPlus, QrCode, Trash2, Gift, ArrowRight
} from "lucide-react";
import recyc1 from "../resources/recyc1.jpg";

const features = [
    { icon: <Target className="w-5 h-5 text-green-600" />, label: "Smart Tracking" },
    { icon: <Globe className="w-5 h-5 text-green-600" />, label: "Eco-Friendly" },
    { icon: <Lightbulb className="w-5 h-5 text-green-600" />, label: "Smart Technology" },
    { icon: <HandshakeIcon className="w-5 h-5 text-green-600" />, label: "Community-Driven" },
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

export default function AboutSection() {

    const howItWorksRef = useRef(null);

    const scrollToHowItWorks = () => {
        howItWorksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };


    return (
        <div className="w-full bg-white">
            <main className="w-full mx-auto">
                <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
                    <div className="flex flex-col lg:flex-row items-center gap-14 lg:gap-16">

                        {/* Left: Image */}
                        <div className="relative w-full lg:w-1/2 flex-shrink-0 mb-6 lg:mb-0">
                            <div className="rounded-2xl overflow-hidden shadow-xl w-full aspect-[4/3]">
                                <img
                                    src={recyc1}
                                    alt="SmartBin waste management"
                                    className="w-full h-full object-cover"
                                />
                            </div>

                            {/* Floating badge — top right */}
                            <div className="absolute -top-4 -right-4 w-12 h-12 sm:w-14 sm:h-14 bg-green-500 rounded-2xl flex items-center justify-center shadow-lg">
                                <Leaf className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
                            </div>

                            {/* Floating badge — bottom left */}
                            <div className="absolute -bottom-4 -left-4 w-14 h-14 sm:w-16 sm:h-16 bg-white rounded-2xl flex items-center justify-center shadow-xl border border-gray-100">
                                <Sparkles className="w-7 h-7 sm:w-8 sm:h-8 text-green-500" />
                            </div>
                        </div>

                        {/* Right: Text */}
                        <div className="w-full lg:w-1/2">
                            <span className="inline-flex items-center gap-2 bg-green-100 text-green-700 text-sm font-medium px-3 py-1.5 rounded-full mb-5">
                                <Users className="w-4 h-4" />
                                About Us
                            </span>

                            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-5 leading-tight">
                                About SmartBin
                            </h2>

                            <p className="text-gray-600 leading-relaxed mb-4">
                                SmartBin is an innovative waste management solution designed to promote proper waste
                                segregation and environmental responsibility within communities. By combining QR
                                technology, smart monitoring, and incentive-based rewards, the system encourages
                                residents to participate actively in maintaining a cleaner and greener environment.
                            </p>

                            <p className="text-gray-600 leading-relaxed mb-8">
                                SmartBin helps local governments improve waste collection efficiency, reduce improper
                                disposal, and build sustainable communities for future generations.
                            </p>

                            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                                {features.map((f) => (
                                    <div key={f.label} className="flex items-center gap-3">
                                        <div className="w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center flex-shrink-0">
                                            {f.icon}
                                        </div>
                                        <span className="font-semibold text-gray-800 text-sm sm:text-base">{f.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    {/* Scroll-down cue: jumps to the "SmartBin in Action" video section below, not past it */}
                    <div className="pt-12 sm:pt-16 flex justify-center">
                        <button
                            onClick={scrollToHowItWorks}
                            className="group flex flex-col items-center gap-2 cursor-pointer"
                            aria-label="Scroll to How It Works"
                        >
                            <span className="w-10 h-10 rounded-full border border-gray-300 group-hover:border-green-500 flex items-center justify-center animate-bounce transition-colors">
                                <ChevronDown className="w-5 h-5 text-gray-500 group-hover:text-green-500" />
                            </span>
                        </button>
                    </div>
                </section>

                {/* HOW IT WORKS SECTION */}
                <section
                    ref={howItWorksRef}
                    className="bg-gradient-to-b from-emerald-50/60 via-white to-white py-16 sm:py-24">
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


                </section>

            </main>
        </div>
    );
}