export type Team = "boy" | "girl";
export type Stage = "loading" | "select" | "camera" | "result";
export type Slot = string | null;

/** "instant" fires on tap; "timer" counts down first. */
export type CaptureMode = "instant" | "timer";

export const SHOT_COUNT = 3;

export const TIMER_MIN = 1;
export const TIMER_MAX = 15;
export const TIMER_DEFAULT = 3;

import type { CSSProperties } from "react";

export type Palette = {
  /** Marquee lamp colour for this team. */
  lamp: string;
  lampDeep: string;
  lampGlow: string;
  /** Word printed on the strip. */
  word: string;
};

export const PALETTE: Record<Team, Palette> = {
  boy: {
    lamp: "#4fb3ff",
    lampDeep: "#1f6fb8",
    lampGlow: "rgba(79, 179, 255, 0.45)",
    word: "Team Boy"
  },
  girl: {
    lamp: "#ff6fa8",
    lampDeep: "#c23c74",
    lampGlow: "rgba(255, 111, 168, 0.45)",
    word: "Team Girl"
  }
};

/**
 * CSS custom properties aren't part of React's CSSProperties, so funnel them
 * through one typed helper instead of casting at every call site.
 */
export function lampVars(team: Team, extra?: CSSProperties): CSSProperties {
  const p = PALETTE[team];
  return {
    ...extra,
    ["--lamp" as never]: p.lamp,
    ["--lamp-glow" as never]: p.lampGlow
  } as CSSProperties;
}
