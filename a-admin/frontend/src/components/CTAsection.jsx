import { Leaf, MailIcon } from "lucide-react";

export default function CTAsection() {

    const GMAIL_COMPOSE_URL = "https://mail.google.com/mail/?view=cm&fs=1&to=Smartbin2000@gmail.com";

    return (
        <div className="w-full bg-gradient-to-br from-green-50 to-white">
            <main className="w-full mx-auto">
                <section className="w-full">
                    {/* CTA */}
                    <div className="w-full bg-green-600 text-white">
                        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 lg:py-24 flex flex-col items-center justify-center text-center">
                            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-6">
                                <Leaf className="text-green-600" size={32} />
                            </div>

                            <h2 className="text-3xl md:text-4xl font-bold mb-3">
                                Make a difference!
                            </h2>

                            <h3 className="text-xl md:text-2xl font-semibold mb-5">
                                Transform Waste Management in Your Community!
                            </h3>

                            <p className="text-green-100 mb-8 max-w-xl">
                                Join barangays and communities that are building a cleaner, smarter, and more sustainable future with SmartBin.
                            </p>

                            <div className="flex flex-col sm:flex-row gap-4 justify-center">
                                <button
                                    onClick={() => window.open(GMAIL_COMPOSE_URL, "_blank", "noopener,noreferrer")}
                                    className="flex items-center gap-2 cursor-pointer bg-white/20 backdrop-blur text-white px-8 py-3 rounded-lg font-semibold hover:bg-white/30 transition-colors">
                                    <MailIcon className="w-5 h-5" />
                                    Contact Us
                                </button>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
}