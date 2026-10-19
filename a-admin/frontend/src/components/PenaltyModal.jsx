import { X, Asterisk } from "lucide-react";
import { useState } from "react";
import ConfirmationModal from "./confirmationModal";
import SuccessToast from "../assets/Toast";

const PROVISION = {
    id: 4,
    name: "Mixing of segregated waste once it has already been separated",
    title: "Mixing of segregated waste once it has already been separated",
};

export default function PenaltyModal({ isOpen, onClose, household }) {
    const [active, setActive] = useState(false);
    const [showToast, setShowToast] = useState(false);
    const [offenseCount, setOffenseCount] = useState(1);

    if (!isOpen) return null;

    // Penalty Logic
    let penaltyType = "";
    let pointDeduction = 0;
    let fine = 0;
    let communityService = "";

    if (offenseCount === 1) {
        penaltyType = "Point Deduction";
        pointDeduction = 500;
    }

    if (offenseCount === 2) {
        penaltyType = "Fine";
        fine = 300;
    }

    if (offenseCount >= 3) {
        penaltyType = "Fine + Community Service";
        fine = 800;
        communityService = "15 Days Community Service";
    }

    const handleConfirm = () => {
        setActive(false);
        setShowToast(true);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-2xl max-h-[90vh] rounded-2xl shadow-lg flex flex-col overflow-hidden">

                {/* HEADER */}
                <div className="flex justify-between items-center px-6 py-4 border-b">
                    <h2 className="text-xl font-bold">
                        {household?.name || "Household Violation"}
                    </h2>
                    <button onClick={onClose}>
                        <X className="text-gray-500 hover:text-red-400 cursor-pointer" />
                    </button>
                </div>

                {/* BODY */}
                <div className="overflow-y-auto px-6 py-6 flex flex-col gap-6">


                    {/* Violation Description */}
                    <div className="bg-gray-50 p-4 rounded-lg border">
                        <h3 className="font-semibold mb-2">Violation</h3>
                        <p className="text-gray-600">{PROVISION.title}</p>
                    </div>

                    {/* Offense Number */}
                    <div className="flex flex-col">
                        <label className="font-semibold">Offense Number</label>
                        <select
                            value={offenseCount}
                            onChange={(e) => setOffenseCount(Number(e.target.value))}
                            className="mt-1 border rounded-lg py-2"
                        >
                            <option value={1}>1st Offense</option>
                            <option value={2}>2nd Offense</option>
                            <option value={3}>3rd Offense</option>
                        </select>
                    </div>

                    {/* Penalty Display */}
                    <div className="bg-red-100 p-4 rounded-lg border border-red-200">
                        <h3 className="font-semibold text-red-700 mb-3">
                            Penalty Details
                        </h3>

                        <div className="flex flex-col gap-2 text-sm">
                            <p>
                                <span className="font-semibold">Penalty Type:</span> {penaltyType}
                            </p>

                            {pointDeduction > 0 && (
                                <p>
                                    <span className="font-semibold">Point Deduction:</span> -{pointDeduction} points
                                </p>
                            )}

                            {fine > 0 && (
                                <p>
                                    <span className="font-semibold">Fine:</span> ₱{fine}
                                </p>
                            )}

                            {communityService && (
                                <p>
                                    <span className="font-semibold">Community Service:</span> {communityService}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Submit Button */}
                    <button
                        onClick={() => setActive(true)}
                        className="bg-red-600 cursor-pointer text-white py-2 rounded-lg hover:bg-red-700 transition"
                    >
                        Assign Penalty
                    </button>

                </div>

                <ConfirmationModal
                    isOpen={active}
                    onClose={() => setActive(false)}
                    onConfirm={handleConfirm}
                />

                <SuccessToast
                    show={showToast}
                    onClose={() => setShowToast(false)}
                    message="Penalty successfully assigned!"
                />

            </div>
        </div>
    );
}