"use client";

import { useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  showCloseButton?: boolean;
  closeOnBackdrop?: boolean;
}

// ─── Size Map ─────────────────────────────────────────────────
const sizeMap = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  full: "max-w-[95vw] max-h-[95vh]",
};

// ─── Backdrop Variants ────────────────────────────────────────
const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

// ─── Modal Panel Variants ─────────────────────────────────────
const panelVariants = {
  hidden: { opacity: 0, scale: 0.88, y: 24 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 380,
      damping: 28,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.92,
    y: 16,
    transition: { duration: 0.18, ease: "easeIn" },
  },
};

// ─── Modal ────────────────────────────────────────────────────
export default function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  className,
  size = "md",
  showCloseButton = true,
  closeOnBackdrop = true,
}: ModalProps) {
  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    },
    [isOpen, onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            key="modal-backdrop"
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.22 }}
            className="absolute inset-0"
            style={{
              background: "rgba(0,0,0,0.72)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
            onClick={closeOnBackdrop ? onClose : undefined}
          />

          {/* Panel */}
          <motion.div
            key="modal-panel"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="dialog"
            aria-modal
            aria-labelledby={title ? "modal-title" : undefined}
            className={cn(
              "relative w-full rounded-2xl overflow-hidden z-10",
              sizeMap[size],
              className
            )}
            style={{
              background: "rgba(12, 12, 22, 0.92)",
              backdropFilter: "blur(28px)",
              WebkitBackdropFilter: "blur(28px)",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow:
                "0 40px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(239,68,68,0.15), inset 0 1px 0 rgba(255,255,255,0.08)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Gradient top edge */}
            <div
              className="absolute inset-x-0 top-0 h-px pointer-events-none"
              style={{
                background:
                  "linear-gradient(90deg, transparent, rgba(239,68,68,0.4), rgba(219,39,119,0.4), transparent)",
              }}
            />

            {/* Header */}
            {(title || showCloseButton) && (
              <div
                className="flex items-start justify-between px-6 pt-5 pb-4"
                style={{ borderBottom: title ? "1px solid rgba(255,255,255,0.07)" : "none" }}
              >
                <div>
                  {title && (
                    <h2 id="modal-title" className="text-lg font-semibold text-white">
                      {title}
                    </h2>
                  )}
                  {description && (
                    <p className="text-sm text-white/50 mt-1">{description}</p>
                  )}
                </div>
                {showCloseButton && (
                  <motion.button
                    onClick={onClose}
                    whileHover={{ scale: 1.1, backgroundColor: "rgba(255,255,255,0.1)" }}
                    whileTap={{ scale: 0.9 }}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white transition-colors flex-shrink-0 ml-4"
                  >
                    <X className="w-4 h-4" />
                  </motion.button>
                )}
              </div>
            )}

            {/* Body */}
            <div className="px-6 pb-6 pt-4 overflow-y-auto max-h-[80vh]">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
