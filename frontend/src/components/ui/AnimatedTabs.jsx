import { useState } from "react";
import { motion } from "framer-motion";

export default function AnimatedTabs({ items, value, onChange, className = "" }) {
  return (
    <div className={`flex ${className}`}>
      {items.map((item) => {
        const isActive = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`relative px-3 py-1.5 text-xs font-medium uppercase tracking-wider transition-colors ${
              isActive ? "text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {isActive && (
              <motion.div
                layoutId="activeTab"
                className="absolute inset-0 bg-zinc-800"
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              />
            )}
            <span className="relative z-10">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
