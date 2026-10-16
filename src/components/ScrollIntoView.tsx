"use client";

import { useEffect, useRef } from "react";

/** Brings a message into view when the page opens (e.g. "Payment saved" at the bottom of a long page on a phone). */
export default function ScrollIntoView({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);
  return <div ref={ref}>{children}</div>;
}
