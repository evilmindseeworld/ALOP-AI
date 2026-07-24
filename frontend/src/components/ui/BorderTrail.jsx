import { motion } from "framer-motion";

export default function BorderTrail({ children, className = "", isLoading = false }) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {isLoading && (
        <motion.div
          className="absolute inset-0 z-0"
          style={{
            background: "linear-gradient(90deg, transparent, #00f0ff, transparent)",
          }}
          animate={{
            x: ["-100%", "100%"],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      )}
      <div className="relative z-10 h-full w-full">{children}</div>
    </div>
  );
}
