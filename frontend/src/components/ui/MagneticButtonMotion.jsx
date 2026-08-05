import { useRef, useState } from "react";
import { motion } from "framer-motion";

export default function MagneticButton({ children, className = "", onClick, disabled = false, ariaLabel }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouse = (e) => {
    if (disabled) return;
    const { clientX, clientY } = e;
    const { left, top, width, height } = ref.current.getBoundingClientRect();
    const x = (clientX - left - width / 2) * 0.2;
    const y = (clientY - top - height / 2) * 0.2;
    setPosition({ x, y });
  };

  const reset = () => setPosition({ x: 0, y: 0 });

  return (
    <motion.button
      ref={ref}
      // A bare <button> defaults to type="submit". Nothing has been caught by
      // that yet only because these currently sit outside any form — and the
      // Suspense fallback in MagneticButton.jsx has to match this element
      // exactly, so the two disagreeing about it would be a behaviour change
      // that appears and disappears with a chunk download.
      type="button"
      onMouseMove={handleMouse}
      onMouseLeave={reset}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={className}
      style={{ display: "inline-flex" }}
      animate={{ x: position.x, y: position.y }}
      transition={{ type: "spring", stiffness: 150, damping: 12, mass: 0.1 }}
      whileTap={{ scale: 0.92 }}
    >
      {children}
    </motion.button>
  );
}
