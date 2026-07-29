import {
    QrCode, Recycle, Trophy, Leaf, ArrowRight,
    Target, Globe, Lightbulb, HandshakeIcon, Sparkles, Users,
    ChevronDown
} from "lucide-react";

import recyc1 from "../resources/recyc1.jpg"


const features = [
    { icon: <Target className="w-5 h-5 text-green-600" />, label: "Smart Tracking" },
    { icon: <Globe className="w-5 h-5 text-green-600" />, label: "Eco-Friendly" },
    { icon: <Lightbulb className="w-5 h-5 text-green-600" />, label: "Smart Technology" },
    { icon: <HandshakeIcon className="w-5 h-5 text-green-600" />, label: "Community-Driven" },
];


export default function AboutSection({ scrollDown }) {
    return (
        <div className="w-full bg-white">
            <main className="w-full mx-auto">

                <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
                    <div className="flex flex-col lg:flex-row items-center gap-10 lg:gap-16">

                        {/* Left: Image */}
                        <div className="relative w-full lg:w-1/2 flex-shrink-0">
                            <div className="rounded-2xl overflow-hidden shadow-xl w-full aspect-[4/3]">
                                <img
                                    src={recyc1}
                                    alt="SmartBin waste management"
                                    className="w-full h-full object-cover"
                                />
                            </div>

                            {/* Floating badge — top right */}
                            <div className="absolute -top-4 -right-4 w-14 h-14 bg-green-500 rounded-2xl flex items-center justify-center shadow-lg">
                                <Leaf className="w-7 h-7 text-white" />
                            </div>

                            {/* Floating badge — bottom left */}
                            <div className="absolute -bottom-4 -left-4 w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-xl border border-gray-100">
                                <Sparkles className="w-8 h-8 text-green-500" />
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

                            <div className="grid grid-cols-2 gap-4">
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
                    <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-15 flex justify-center">
                        <button
                            onClick={scrollDown}
                            className="flex flex-col items-center gap-2 cursor-pointer transition-colors">
                            <span className="w-10 h-10 rounded-full border border-gray-300 group-hover:border-green-500 flex items-center justify-center animate-bounce">
                                <ChevronDown className="w-5 h-5" />
                            </span>
                        </button>
                    </section>
                </section>


            </main>
        </div >
    );
}