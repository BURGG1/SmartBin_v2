import { X, Calendar, Flag, Plus, PlusCircle, Asterisk } from "lucide-react";
import { useState } from "react";



export default function ConfirmationModal({ isOpen, onClose, onConfirm }) {

    if (!isOpen) return null;


    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white w-auto max-w-lg rounded-2xl shadow-lg overflow-hidden">

                {/* HEADER */}
                <div className="flex justify-between items-center px-6 py-4 border-b">
                    <h3 className="text-md">Confirmation Modal</h3>
                    <button onClick={onClose}>
                        <X className="text-gray-500 hover:text-red-400 cursor-pointer" />
                    </button>
                </div>

                <main className="flex flex-col justify-center gap-5 p-5 items-center">


                    <h1 className="text-lg font-bold">Are you sure to continue this action?</h1>
                    <div className="flex gap-3 items-center">
                        <button
                            onClick={onConfirm}
                            className="bg-green-600 cursor-pointer text-white p-2 px-5 rounded-lg">
                            Confirm
                        </button>
                        <button
                            onClick={onClose}
                            className="bg-gray-600 cursor-pointer text-white p-2 px-5 rounded-lg">
                            Cancel
                        </button>
                    </div>
                </main>

            </div>
        </div>
    );
}
