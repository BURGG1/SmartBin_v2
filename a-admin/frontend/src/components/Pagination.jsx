import { ChevronLeft, ChevronRight } from "lucide-react";

export default function Pagination({ currentPage, totalItems, itemsPerPage, onPageChange }) {
    const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));

    if (totalPages <= 1) return null;

    return (
        <div className="flex items-center justify-center sm:justify-end gap-1 mt-4 pt-4 border-t">
            <button
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-lg text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 cursor-pointer"
                aria-label="Previous page"
            >
                <ChevronLeft size={16} />
            </button>

            <span
                className="min-w-[3.5rem] px-3 py-1 rounded-lg border text-sm text-center bg-gray-900 text-white border-gray-900 cursor-default"
                aria-live="polite"
            >
                {currentPage}/{totalPages}
            </span>

            <button
                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 cursor-pointer"
                aria-label="Next page"
            >
                <ChevronRight size={16} />
            </button>
        </div>
    );
}