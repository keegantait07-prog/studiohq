"use client";

// Adapted from Skiper 16 (StickyCard_001): same sticky stack that scales a card back as the next one slides over it.
// Changes: takes children instead of an image, and a sticky offset in px so card headers stay visible.
import { motion, useTransform, type MotionValue } from "framer-motion";
import type { ReactNode } from "react";

export function StickyCard({ i, offset = 46, progress, range, targetScale, className, children }: {
  i: number; offset?: number; progress: MotionValue<number>; range: [number, number]; targetScale: number; className?: string; children: ReactNode
}) {
  const scale = useTransform(progress, range, [1, targetScale]);
  return (
    <div className="sticky" style={{ top: i * offset }}>
      <motion.div style={{ scale, transformOrigin: "top" }} className={className}>
        {children}
      </motion.div>
    </div>
  );
}
