import { Trash2, MapPin, Phone, Mail, Facebook, Twitter, Instagram, MailIcon } from "lucide-react";

const footerLinks = {
  Company: ["About", "Features", "Contact"],
  Resources: ["Documentation", "User Guide", "Support"],
};

const socialLinks = [
  { name: "Facebook",  icon: <Facebook  className="w-4 h-4 text-gray-300" /> },
  { name: "Twitter",   icon: <Twitter   className="w-4 h-4 text-gray-300" /> },
  { name: "Instagram", icon: <Instagram className="w-4 h-4 text-gray-300" /> },
];

export default function LandingFooter() {
  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 flex justify-between gap-10">

        {/* Brand */}
        <div className="sm:col-span-2 lg:col-span-1">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 bg-green-500 rounded-lg flex items-center justify-center">
              <Trash2 className="w-5 h-5 text-white" />
            </div>
            <span className="text-white font-bold text-lg">SmartBin</span>
          </div>

          <p className="text-sm leading-relaxed mb-5 text-gray-400">
            Transforming waste management through smart technology for a cleaner, greener future.
          </p>

          <div className="space-y-2.5 text-sm text-gray-400">
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 text-gray-500" />
              <span>
                Bulacan State University<br />Hagonoy Campus
              </span>
            </div>
          
          </div>
        </div>

        

        {/* Social */}
        <div>
          <h4 className="text-white font-semibold mb-4">Contact</h4>
          <div className="flex gap-3 flex-wrap">
            {socialLinks.map(({ name, icon }) => (
              <a
                key={name}
                href="#"
                aria-label={name}
                className="w-9 h-9 rounded-lg bg-gray-800 hover:bg-green-600 transition-colors flex items-center justify-center"
              >
                {icon}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-gray-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-gray-500">
          <span>© 2026 Bulacan State University – Hagonoy Campus. All rights reserved.</span>
          {/* <div className="flex gap-5">
            <a href="#" className="hover:text-gray-300 transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-gray-300 transition-colors">Terms of Service</a>
          </div> */}
        </div>
      </div>
    </footer>
  );
}