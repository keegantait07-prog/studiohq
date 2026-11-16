"use client";

import { motion } from "framer-motion";
import React, { useEffect, useState } from "react";
import useSound from "use-sound";

const Skiper25 = () => {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center">
      <div className="text-foreground absolute top-[20%] grid content-start justify-items-center gap-6 py-20 text-center">
        <span className="after:from-background after:to-foreground relative max-w-[12ch] text-xs uppercase leading-tight opacity-40 after:absolute after:left-1/2 after:top-full after:h-16 after:w-px after:bg-gradient-to-b after:content-['']">
          Click to play the music
        </span>
      </div>
      <MusicToggleButton />
    </div>
  );
};

export { Skiper25 };

export const MusicToggleButton = () => {
  const bars = 5;

  const getRandomHeights = () => {
    return Array.from({ length: bars }, () => Math.random() * 0.8 + 0.2);
  };

  const [heights, setHeights] = useState(getRandomHeights());

  const [isPlaying, setIsPlaying] = useState(false);

  const [play, { pause, sound }] = useSound("/audio/audio.m4a", {
    loop: true,
    onplay: () => setIsPlaying(true),
    onend: () => setIsPlaying(false),
    onpause: () => setIsPlaying(false),
    onstop: () => setIsPlaying(false),
    soundEnabled: true,
  });

  useEffect(() => {
    if (isPlaying) {
      const waveformIntervalId = setInterval(() => {
        setHeights(getRandomHeights());
      }, 100);

      return () => {
        clearInterval(waveformIntervalId);
      };
    }
    setHeights(Array(bars).fill(0.1));
  }, [isPlaying]);

  const handleClick = () => {
    if (isPlaying) {
      pause();
      setIsPlaying(false);
      return;
    }
    play();
    setIsPlaying(true);
  };

  return (
    <>
      <motion.div
        onClick={handleClick}
        key="audio"
        initial={{ padding: "14px 14px " }}
        whileHover={{ padding: "18px 22px " }}
        whileTap={{ padding: "18px 22px " }}
        transition={{ duration: 1, bounce: 0.6, type: "spring" }}
        className="bg-background cursor-pointer rounded-full p-2"
      >
        <motion.div
          initial={{ opacity: 0, filter: "blur(4px)" }}
          animate={{
            opacity: 1,
            filter: "blur(0px)",
          }}
          exit={{ opacity: 0, filter: "blur(4px)" }}
          transition={{ type: "spring", bounce: 0.35 }}
          className="flex h-[18px] w-full items-center gap-1 rounded-full"
        >
          {/* Waveform visualization */}
          {heights.map((height, index) => (
            <motion.div
              key={index}
              className="bg-foreground w-[1px] rounded-full"
              initial={{ height: 1 }}
              animate={{
                height: Math.max(4, height * 14),
              }}
              transition={{
                type: "spring",
                stiffness: 300,
                damping: 10,
              }}
            />
          ))}
        </motion.div>
      </motion.div>
    </>
  );
};

/**
 * Studio HQ adaptation: the same MusicToggleButton motion (springy padding on hover/tap, five spring
 * bars that dance while playing and lie flat when paused), but controlled by the app's own player
 * instead of use-sound. `still` freezes the bars for reduced motion. Children render beside the bars
 * (the app puts a play glyph there while paused).
 */
export const MusicToggle = ({
  playing,
  onToggle,
  label,
  still = false,
  className,
  children,
}: {
  playing: boolean;
  onToggle: () => void;
  label: string;
  still?: boolean;
  className?: string;
  children?: React.ReactNode;
}) => {
  const bars = 5;
  const getRandomHeights = () =>
    Array.from({ length: bars }, () => Math.random() * 0.8 + 0.2);
  const [heights, setHeights] = useState(() => Array(bars).fill(0.1));

  useEffect(() => {
    if (playing && !still) {
      const id = setInterval(() => setHeights(getRandomHeights()), 100);
      return () => clearInterval(id);
    }
    setHeights(Array(bars).fill(playing ? 0.6 : 0.1));
  }, [playing, still]);

  return (
    <motion.button
      type="button"
      onClick={onToggle}
      aria-label={label}
      data-playing={playing ? "" : undefined}
      initial={{ padding: "0px 10px" }}
      whileHover={still ? undefined : { padding: "0px 14px" }}
      whileTap={still ? undefined : { padding: "0px 14px" }}
      transition={{ duration: 1, bounce: 0.6, type: "spring" }}
      className={className}
    >
      {children}
      <motion.span
        aria-hidden="true"
        initial={still ? false : { opacity: 0, filter: "blur(4px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        transition={{ type: "spring", bounce: 0.35 }}
        className="mt-bars"
      >
        {heights.map((height, index) => (
          <motion.i
            key={index}
            initial={{ height: 1 }}
            animate={{ height: Math.max(4, height * 14) }}
            transition={still ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 10 }}
          />
        ))}
      </motion.span>
    </motion.button>
  );
};

/**
 * Skiper 25 Micro Interactions_005 — React + framer motion + use-sound
 *
 * License & Usage:
 * - Free to use and modify in both personal and commercial projects.
 * - Attribution to Skiper UI is required when using the free version.
 * - No attribution required with Skiper UI Pro.
 *
 * Feedback and contributions are welcome.
 *
 * Author: @gurvinder-singh02
 * Website: https://gxuri.me
 * Twitter: https://x.com/Gur__vi
 */
