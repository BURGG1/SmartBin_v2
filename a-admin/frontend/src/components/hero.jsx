import { QrCode, Recycle, Trophy, Leaf, ArrowRight } from "lucide-react";

import recyc1 from "../resources/recyc1.jpg";
import recycVid from "../resources/smartbinC.mp4";

export default function Hero({ learnMore}) {
    return (
        <div className="w-full min-h-screen bg-gradient-to-br from-green-400 to-white">
            <main className="w-full mx-auto">

                {/* HERO SECTION */}
                <section className="w-full min-h-screen flex items-center">
                    <div className="w-full px-8 lg:px-20 py-12 grid lg:grid-cols-2 gap-12 items-center">

                        {/* LEFT */}
                        <div>
                            <span className="inline-flex items-center gap-2 bg-green-100 text-green-700 px-4 py-1 rounded-full text-sm mb-4">
                                <Leaf className="w-4 h-4" />
                                Eco-Friendly Waste Management
                            </span>

                            <h1 className="text-5xl lg:text-7xl font-bold text-gray-900 leading-tight mb-6">
                                Smart Bin Waste
                                <br />
                                Management System
                            </h1>

                            <p className="text-lg text-gray-700 max-w-xl mb-8">
                                Join our community in responsible waste segregation and earn
                                rewards for being environmentally conscious. Together, we can
                                make our barangay cleaner and greener.
                            </p>

                            <button
                                onClick={learnMore}
                                className="bg-green-600 hover:bg-green-700 text-white px-8 py-4 rounded-xl font-medium flex items-center gap-2">
                                    
                                Learn More
                                <ArrowRight className="w-5 h-5" />
                            </button>
                        </div>

                        {/* RIGHT */}
                        <div className="relative h-[90vh]">
                            <video
                                src={recycVid}
                                poster={recyc1}
                                autoPlay
                                muted
                                loop
                                playsInline
                                className="absolute inset-0 w-full h-full blur-xs object-cover rounded-l-[60px]"
                            />
                        </div>

                    </div>
                </section>

            </main>
        </div>
    );
}