"use client";

import { useEffect, useRef, useState } from "react";

export default function LoadingScreen({ onDone }: { onDone: () => void }) {
  const [ready, setReady] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    let cancelled = false;

    const fontsReady =
      typeof document !== "undefined" && document.fonts
        ? document.fonts.ready.catch(() => undefined)
        : Promise.resolve(undefined);

    // A floor on the wait so the marquee reads as warming up rather than
    // flickering past, but never a ceiling that blocks a slow font load.
    const minTime = new Promise<void>((res) => setTimeout(res, 1200));

    Promise.all([fontsReady, minTime]).then(() => {
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => doneRef.current(), 220);
    return () => clearTimeout(t);
  }, [ready]);

  return (
    <div
      className="screen curtain"
      style={{
        alignItems: "center",
        justifyContent: "center",
        gap: 26
      }}
    >
      <div style={{ display: "flex", gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="bulb"
            style={{
              width: 13,
              height: 13,
              animationDelay: `${i * 0.32}s`,
              // Alternating lamps: the booth doesn't know the answer yet.
              ["--lamp" as string]: i === 1 ? "#4fb3ff" : "#ff6fa8",
              ["--lamp-glow" as string]:
                i === 1 ? "rgba(79,179,255,0.5)" : "rgba(255,111,168,0.5)"
            }}
          />
        ))}
      </div>

      <div style={{ textAlign: "center", padding: "0 32px" }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 38,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            lineHeight: 1.05
          }}
        >
          Reveal Booth
        </div>
        <div style={{ fontSize: 14, opacity: 0.6, marginTop: 10, letterSpacing: "0.01em" }}>
          Warming up the lamps
        </div>
      </div>

      <div style={{ position: "relative", width: 34, height: 34, opacity: 0.8 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: "3px solid rgba(244,235,221,0.14)"
          }}
        />
        <div
          className="spin"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: "3px solid transparent",
            borderTopColor: "var(--brass)"
          }}
        />
      </div>
    </div>
  );
}
