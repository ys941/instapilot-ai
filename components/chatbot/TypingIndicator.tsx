"use client";

import { motion } from "framer-motion";

// ─── Typing Indicator ─────────────────────────────────────────
// Three animated bouncing dots shown while the assistant is thinking.
// Renders inside a glass-morphism bubble matching bot message style.
// ──────────────────────────────────────────────────────────────

const dotVariants = {
  initial: { y: 0, opacity: 0.4 },
  animate: { y: -6, opacity: 1 },
};

const containerVariants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.18,
      repeat: Infinity,
      repeatType: "mirror" as const,
      duration: 0.5,
    },
  },
};

export default function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 mb-4">
      {/* Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-brand via-brand-light to-purple-700 flex items-center justify-center shadow-lg">
        <span className="text-white text-xs font-bold">CF</span>
      </div>

      {/* Bubble */}
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 4, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="relative px-4 py-3 rounded-2xl rounded-tl-sm max-w-[140px]"
        style={{
          background: "rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        }}
      >
        <motion.div
          className="flex items-center gap-[5px]"
          variants={containerVariants}
          initial="initial"
          animate="animate"
        >
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="block w-2 h-2 rounded-full bg-gradient-to-br from-brand to-brand-light"
              variants={dotVariants}
              transition={{
                duration: 0.45,
                ease: "easeInOut",
                repeat: Infinity,
                repeatType: "mirror",
                delay: i * 0.18,
              }}
            />
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
}
