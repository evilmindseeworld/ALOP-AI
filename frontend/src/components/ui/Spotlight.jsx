import { useRef, useState } from "react";
import { motion } from "framer-motion";

export default function Spotlight({ children, className = "" }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouse = (e) => {
    const { left, top } = ref.current.getBoundingClientRect();
    setPosition({ x: e.clientX - left, y: e.clientY - top });
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMouse}
      className={`relative overflow-hidden ${className}`}
    >
      <motion.div
        className="pointer-events-none absolute rounded-full blur-3xl"
        style={{
          width: 200,
          height: 200,
          background: "radial-gradient(circle, rgba(0,240,255,0.25), transparent 70%)",
          left: position.x - 100,
          top: position.y - 100,
        }}
        animate={{ opacity: position.x ? 1 : 0 }}
        transition={{ duration: 0.2 }}
      />
      {children}
    </div>
  );
}
