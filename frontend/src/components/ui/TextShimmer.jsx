import { motion } from "framer-motion";

export default function TextShimmer({ children, className = "" }) {
  return (
    <motion.span
      className={`inline-block bg-clip-text text-transparent ${className}`}
      style={{
        backgroundImage: "linear-gradient(90deg, #444 0%, #00f0ff 50%, #444 100%)",
        backgroundSize: "200% 100%",
      }}
      animate={{
        backgroundPosition: ["200% 0%", "-200% 0%"],
      }}
      transition={{
        duration: 2,
        repeat: Infinity,
        ease: "linear",
      }}
    >
      {children}
    </motion.span>
  );
}
