"use client";

import { PALETTE, type Team } from "@/lib/types";

export default function TeamSelect({ onPick }: { onPick: (team: Team) => void }) {
  return (
    <div className="screen curtain">
      <header
        style={{
          padding: "26px 24px 4px",
          textAlign: "center"
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 34,
            fontWeight: 700,
            lineHeight: 1.08,
            letterSpacing: "-0.015em",
            margin: 0
          }}
        >
          Which side are you on?
        </h1>
        <p
          style={{
            fontSize: 14,
            opacity: 0.58,
            margin: "10px 0 0",
            lineHeight: 1.5,
            maxWidth: "36ch",
            marginInline: "auto"
          }}
        >
          Pick a lamp, take three photos, keep the strip.
        </p>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: "18px 18px 24px",
          justifyContent: "center"
        }}
      >
        <BoothPanel team="boy" onClick={() => onPick("boy")} />
        <BoothPanel team="girl" onClick={() => onPick("girl")} />
      </div>
    </div>
  );
}

function BoothPanel({ team, onClick }: { team: Team; onClick: () => void }) {
  const p = PALETTE[team];

  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        minHeight: 180,
        maxHeight: 300,
        position: "relative",
        borderRadius: 18,
        overflow: "hidden",
        color: "var(--paper)",
        background: `radial-gradient(125% 82% at 50% 0%, ${p.lampDeep}66 0%, rgba(23,15,20,0.92) 74%)`,
        border: `1px solid ${p.lamp}3d`,
        boxShadow: `0 16px 34px -20px ${p.lampGlow}, inset 0 1px 0 rgba(255,255,255,0.06)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        padding: "38px 18px 18px"
      }}
    >
      {/* Marquee bulbs along the top edge of the panel. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 14,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: 14
        }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="bulb"
            style={{
              width: 9,
              height: 9,
              animationDelay: `${i * 0.18}s`,
              ["--lamp" as string]: p.lamp,
              ["--lamp-glow" as string]: p.lampGlow
            }}
          />
        ))}
      </span>

      <span
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          fontFamily: "var(--font-display)",
          fontSize: 42,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color: p.lamp,
          textShadow: `0 0 26px ${p.lampGlow}`
        }}
      >
        {p.word}
      </span>

      <span className="plate">Step in</span>
    </button>
  );
}
