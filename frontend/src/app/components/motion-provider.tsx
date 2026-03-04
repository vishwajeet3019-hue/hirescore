"use client";

import { MotionConfig } from "framer-motion";

type MotionProviderProps = {
  children: React.ReactNode;
};

export default function MotionProvider({ children }: MotionProviderProps) {
  return <MotionConfig reducedMotion="always">{children}</MotionConfig>;
}
