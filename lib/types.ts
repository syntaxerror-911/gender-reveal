export type Team = "boy" | "girl";
export type Stage = "loading" | "select" | "camera" | "result";
export type Slot = string | null;

/** "instant" fires on tap; "timer" counts down first. */
export type CaptureMode = "instant" | "timer";

/** Which way the frame is cropped when a shot is taken. */
export type CaptureOrientation = "portrait" | "landscape";

/** Output pixel size for each orientation — swapped, not stretched. */
export const CAPTURE_DIMS: Record<CaptureOrientation, { w: number; h: number }> = {
  portrait: { w: 900, h: 1200 },
  landscape: { w: 1200, h: 900 }
};

export const SHOT_COUNT = 3;

export const TIMER_MIN = 1;
export const TIMER_MAX = 15;
export const TIMER_DEFAULT = 3;

/** Digital zoom: a crop-and-scale on the frame, not a hardware lens, so it
    works the same on every device regardless of camera API support. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.5;
export const ZOOM_DEFAULT = 1;

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
