"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAPTURE_DIMS,
  PALETTE,
  SHOT_COUNT,
  TIMER_DEFAULT,
  TIMER_MAX,
  TIMER_MIN,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  type CaptureMode,
  type CaptureOrientation,
  type Slot,
  type Team
} from "@/lib/types";

type PermState = "idle" | "requesting" | "granted" | "denied" | "error";
type Facing = "user" | "environment";

/** A camera's real optical/hybrid zoom range, when the hardware exposes one. */
type ZoomCapability = { min: number; max: number; step: number };

/** Best-effort: reads the non-standard `zoom` capability some browsers add
    to MediaTrackCapabilities (Chrome/Android and recent Safari on multi-lens
    iPhones). Returns null wherever it isn't exposed, which is most desktops
    and many phones — callers fall back to the digital crop-zoom there. */
function readZoomCapability(track: MediaStreamTrack): ZoomCapability | null {
  try {
    const caps = track.getCapabilities?.() as
      | (MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number } })
      | undefined;
    const z = caps?.zoom;
    if (!z || !(z.max > z.min)) return null;
    return { min: z.min, max: z.max, step: z.step && z.step > 0 ? z.step : 0.1 };
  } catch {
    return null;
  }
}

function readCurrentZoom(track: MediaStreamTrack, fallback: number): number {
  try {
    const settings = track.getSettings?.() as (MediaTrackSettings & { zoom?: number }) | undefined;
    return typeof settings?.zoom === "number" ? settings.zoom : fallback;
  } catch {
    return fallback;
  }
}

/** Pushes a hardware zoom level to the live track. Rejections are silent —
    the digital crop path (or simply no-op) covers any browser that refuses
    live constraint changes. */
function setTrackZoom(track: MediaStreamTrack, zoom: number): void {
  try {
    void (
      track as MediaStreamTrack & { applyConstraints(c: { advanced: Array<{ zoom: number }> }): Promise<void> }
    ).applyConstraints({ advanced: [{ zoom }] });
  } catch {
    /* Not every browser/camera accepts a live zoom constraint. */
  }
}

/** Native camera apps offer familiar lens stops (.5x, 1x, 2x…) rather than a
    free slider — pick the ones that actually fall inside this camera's
    supported range, capped so the pill row never crowds a narrow phone. */
function zoomPresets(cap: ZoomCapability): number[] {
  const candidates = [0.5, 1, 2, 3, 5];
  const stops = candidates.filter((v) => v >= cap.min - 0.001 && v <= cap.max + 0.001);
  if (!stops.some((v) => Math.abs(v - cap.min) < 0.001)) stops.unshift(cap.min);
  if (!stops.some((v) => Math.abs(v - cap.max) < 0.001)) stops.push(cap.max);
  const rounded = Array.from(new Set(stops.map((v) => Math.round(v * 10) / 10))).sort((a, b) => a - b);
  return rounded.slice(0, 4);
}

export default function Camera({
  team,
  photos,
  onPhotosChange,
  onDone,
  onBack
}: {
  team: Team;
  photos: Slot[];
  onPhotosChange: (p: Slot[]) => void;
  onDone: () => void;
  onBack: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  /** A second, blurred cover-fit view of the same stream sitting behind the
      real preview, so the frame is always full — the sharp foreground never
      has to crop the scene to fill the shape, it just gets padded. */
  const bgVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedRef = useRef(false);

  const [perm, setPerm] = useState<PermState>("idle");
  const [facing, setFacing] = useState<Facing>("user");
  const [orientation, setOrientation] = useState<CaptureOrientation>("portrait");
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [zoomCaps, setZoomCaps] = useState<ZoomCapability | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [flash, setFlash] = useState(false);
  const [showStrip, setShowStrip] = useState(false);

  /** Preview is locked to the capture ratio so framing is honest. */
  const previewRatio = `${CAPTURE_DIMS[orientation].w} / ${CAPTURE_DIMS[orientation].h}`;

  const [mode, setMode] = useState<CaptureMode>("instant");
  const [timerSec, setTimerSec] = useState(TIMER_DEFAULT);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // First empty slot, or the first slot when the roll is already full.
  // findIndex returns -1 (never undefined), which is what broke the original
  // `?? 0` guard and let captures write to photos[-1].
  const [activeIndex, setActiveIndex] = useState(() => {
    const i = photos.findIndex((p) => !p);
    return i === -1 ? 0 : i;
  });

  const p = PALETTE[team];

  /* Refs mirroring state, so timer callbacks never read a stale closure. */
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const activeRef = useRef(activeIndex);
  activeRef.current = activeIndex;
  const facingRef = useRef(facing);
  facingRef.current = facing;
  const orientationRef = useRef(orientation);
  orientationRef.current = orientation;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomCapsRef = useRef<ZoomCapability | null>(null);
  const timerSecRef = useRef(timerSec);
  timerSecRef.current = timerSec;
  const onPhotosChangeRef = useRef(onPhotosChange);
  onPhotosChangeRef.current = onPhotosChange;

  /* Every pending timer is tracked so nothing fires after unmount. */
  const tickRef = useRef<number | null>(null);
  const chainRef = useRef<number | null>(null);
  const flashRef = useRef<number | null>(null);
  const sequenceRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);

  const clearTimers = useCallback(() => {
    for (const r of [tickRef, chainRef, flashRef]) {
      if (r.current !== null) {
        window.clearTimeout(r.current);
        r.current = null;
      }
    }
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    startedRef.current = false;
  }, []);

  /* ---------------------------------------------------------------- camera */

  const startCamera = useCallback(async () => {
    setPerm("requesting");
    setErrorMsg("");
    stopStream();

    const open = (constraints: MediaStreamConstraints) =>
      navigator.mediaDevices.getUserMedia(constraints);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPerm("error");
        setErrorMsg("This browser can't open a camera. Try Safari or Chrome.");
        return;
      }

      // Requested independent of portrait/landscape: asking a phone sensor
      // for a tall 1080x1440 stream forces many devices into a tight,
      // hardware-side crop (it reads as an already-zoomed-in preview) since
      // few cameras natively expose that shape. A common 16:9 ideal is
      // satisfied natively almost everywhere, and framing for either output
      // orientation is handled entirely by CSS + the capture crop below.
      const idealDims = { width: { ideal: 1920 }, height: { ideal: 1080 } };

      let stream: MediaStream;
      try {
        stream = await open({
          audio: false,
          video: { facingMode: facing, ...idealDims }
        });
      } catch (err) {
        // Laptops and some tablets have no rear camera; fall back to any lens
        // rather than reporting the whole camera as unavailable.
        if ((err as DOMException)?.name === "OverconstrainedError") {
          stream = await open({ audio: false, video: true });
        } else {
          throw err;
        }
      }

      streamRef.current = stream;
      const video = videoRef.current;
      const bgVideo = bgVideoRef.current;
      if (video) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          // Autoplay rejections are recoverable: the stream is attached and
          // playsInline video resumes on the next interaction.
        }
      }
      if (bgVideo) {
        bgVideo.srcObject = stream;
        bgVideo.play().catch(() => undefined);
      }

      const track = stream.getVideoTracks()[0];
      const capInfo = track ? readZoomCapability(track) : null;
      const initialZoom = capInfo ? readCurrentZoom(track, capInfo.min) : ZOOM_DEFAULT;
      zoomCapsRef.current = capInfo;
      setZoomCaps(capInfo);
      zoomRef.current = initialZoom;
      setZoom(initialZoom);

      startedRef.current = true;
      setPerm("granted");
    } catch (err) {
      const name = (err as DOMException)?.name ?? "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
        setPerm("denied");
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setPerm("error");
        setErrorMsg("No camera found on this device.");
      } else {
        setPerm("error");
        setErrorMsg("The camera didn't open. Close other apps using it, then try again.");
      }
    }
  }, [facing, stopStream]);

  // Restart only after the camera has actually been opened once. Guarding on a
  // ref (not on perm) keeps Strict Mode's double-mount from opening two streams.
  // Orientation is deliberately not a dependency: it only changes the CSS/crop
  // framing, never the underlying stream, so switching it never reopens the camera.
  useEffect(() => {
    if (!startedRef.current) return;
    startCamera();
  }, [startCamera]);

  useEffect(
    () => () => {
      sequenceRef.current = false;
      clearTimers();
      stopStream();
      audioRef.current?.close().catch(() => undefined);
    },
    [clearTimers, stopStream]
  );

  /* ----------------------------------------------------------------- sound */

  const beep = useCallback((final: boolean) => {
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = audioRef.current ?? new Ctx();
      audioRef.current = ctx;
      if (ctx.state === "suspended") ctx.resume().catch(() => undefined);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = final ? 880 : 560;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(final ? 0.16 : 0.09, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (final ? 0.22 : 0.1));
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (final ? 0.24 : 0.12));
    } catch {
      /* Sound is a nicety; never let it break a capture. */
    }
  }, []);

  /* ---------------------------------------------------------------- zoom */

  const setZoomValue = useCallback((raw: number) => {
    const caps = zoomCapsRef.current;
    const clamped = caps
      ? Math.min(caps.max, Math.max(caps.min, raw))
      : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(raw * 10) / 10));
    zoomRef.current = clamped;
    setZoom(clamped);
    if (caps) {
      const track = streamRef.current?.getVideoTracks()[0];
      if (track) setTrackZoom(track, clamped);
    }
  }, []);

  /* --------------------------------------------------------------- capture */

  /** Draws the current frame into the active slot. Returns slots still empty. */
  const captureNow = useCallback((): number => {
    const roll = photosRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth) {
      return roll.filter((s) => !s).length;
    }

    const { w: outW, h: outH } = CAPTURE_DIMS[orientationRef.current];
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return roll.filter((s) => !s).length;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const targetRatio = outW / outH;
    const srcRatio = vw / vh;

    // The cover-fit rect: the tightest crop that fills the frame edge to
    // edge. Used only for the blurred backdrop, and as the far end of the
    // zoom interpolation below — never applied directly to the sharp shot.
    let csx = 0;
    let csy = 0;
    let csw = vw;
    let csh = vh;
    if (srcRatio > targetRatio) {
      csw = vh * targetRatio;
      csx = (vw - csw) / 2;
    } else {
      csh = vw / targetRatio;
      csy = (vh - csh) / 2;
    }

    const flip = () => {
      if (facingRef.current === "user") {
        ctx.translate(outW, 0);
        ctx.scale(-1, 1);
      }
    };

    // Blurred backdrop: a cover-cropped, blurred copy fills the whole frame
    // first, so nothing ever prints as a dead black/empty bar. Drawn a bit
    // oversized so the blur's soft falloff lands outside the visible canvas.
    ctx.save();
    flip();
    ctx.filter = "blur(26px) brightness(0.55) saturate(1.15)";
    const pad = 48;
    ctx.drawImage(video, csx, csy, csw, csh, -pad, -pad, outW + pad * 2, outH + pad * 2);
    ctx.restore();

    // Sharp foreground: at the default 1x this shows the ENTIRE frame,
    // letterboxed over the blurred backdrop rather than cropped — that's
    // the "zoomed out" default. Zooming in blends smoothly toward the
    // cover-fit rect above, so by max zoom it fills edge to edge exactly
    // like the old crop-only behavior. A hardware-zoomed track is already
    // framed by the lens itself, so it always gets the full-frame treatment
    // (t = 0) rather than being cropped again in software.
    const z = zoomCapsRef.current ? 1 : zoomRef.current;
    const t = Math.min(1, Math.max(0, (z - 1) / (ZOOM_MAX - 1)));
    const fsw = vw + (csw - vw) * t;
    const fsh = vh + (csh - vh) * t;
    const fsx = (vw - fsw) / 2;
    const fsy = (vh - fsh) / 2;

    const scale = Math.min(outW / fsw, outH / fsh);
    const fw = fsw * scale;
    const fh = fsh * scale;

    ctx.save();
    flip();
    ctx.drawImage(video, fsx, fsy, fsw, fsh, (outW - fw) / 2, (outH - fh) / 2, fw, fh);
    ctx.restore();

    const next = [...roll];
    const idx = Math.min(Math.max(activeRef.current, 0), next.length - 1);
    next[idx] = canvas.toDataURL("image/jpeg", 0.92);

    photosRef.current = next;
    onPhotosChangeRef.current(next);

    setFlash(true);
    if (flashRef.current !== null) window.clearTimeout(flashRef.current);
    flashRef.current = window.setTimeout(() => setFlash(false), 150);

    const nextEmpty = next.findIndex((s) => !s);
    if (nextEmpty !== -1) {
      activeRef.current = nextEmpty;
      setActiveIndex(nextEmpty);
    }

    return next.filter((s) => !s).length;
  }, []);

  const cancelSequence = useCallback(() => {
    sequenceRef.current = false;
    clearTimers();
    setCountdown(null);
    setBusy(false);
  }, [clearTimers]);

  const runTimedShot = useCallback(() => {
    let n = Math.round(timerSecRef.current);
    setCountdown(n);
    beep(false);

    const tick = () => {
      n -= 1;
      if (n > 0) {
        setCountdown(n);
        beep(n === 1);
        tickRef.current = window.setTimeout(tick, 1000);
        return;
      }

      setCountdown(null);
      const remaining = captureNow();

      // A real booth keeps going until the roll is finished.
      if (sequenceRef.current && remaining > 0) {
        chainRef.current = window.setTimeout(runTimedShot, 1300);
      } else {
        sequenceRef.current = false;
        setBusy(false);
      }
    };

    tickRef.current = window.setTimeout(tick, 1000);
  }, [beep, captureNow]);

  const handleShutter = useCallback(() => {
    if (perm !== "granted" || busy) return;
    if (mode === "instant") {
      captureNow();
      return;
    }
    setBusy(true);
    sequenceRef.current = true;
    runTimedShot();
  }, [busy, captureNow, mode, perm, runTimedShot]);

  const adjustTimer = (delta: number) =>
    setTimerSec((s) => Math.min(TIMER_MAX, Math.max(TIMER_MIN, s + delta)));

  const remainingCount = photos.filter((s) => !s).length;
  const shotCount = SHOT_COUNT - remainingCount;
  const rollComplete = remainingCount === 0;
  const live = perm === "granted";

  const selectFrame = useCallback((i: number) => {
    activeRef.current = i;
    setActiveIndex(i);
    setShowStrip(false);
  }, []);

  /* ------------------------------------------------------------------ view */

  return (
    <div className="screen curtain" style={{ overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px 8px",
          gap: 12
        }}
      >
        <button onClick={onBack} aria-label="Back to team choice" style={roundBtn}>
          <Chevron />
        </button>
        <span className="plate">{p.word}</span>
        {/* Balances the back button so the plate stays centered — the flip,
            orientation and strip-viewer controls all live on the viewfinder
            itself now, not up here. */}
        <span aria-hidden style={{ width: 40, height: 40 }} />
      </header>

      {/* Viewing window inside a brass bezel, locked to the capture ratio.
          Sized purely from CSS aspect-ratio + max-height/max-width so it
          settles into whatever room a phone or a tablet actually has,
          instead of a fixed magic-number budget for the control panel. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 16px"
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            maxHeight: "100%",
            aspectRatio: previewRatio,
            borderRadius: 14,
            overflow: "hidden",
            background: "#0b0709",
            border: "1px solid rgba(192,138,46,0.42)",
            boxShadow: "0 18px 40px -22px rgba(0,0,0,0.9), inset 0 0 0 4px rgba(0,0,0,0.5)"
          }}
        >
          {/* Blurred backdrop: a cover-cropped, blurred copy of the same feed
              so the shape is always filled — the sharp video on top never
              has to crop the scene to do that job. */}
          <video
            ref={bgVideoRef}
            playsInline
            muted
            autoPlay
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `${facing === "user" ? "scaleX(-1) " : ""}scale(1.15)`,
              filter: "blur(26px) brightness(0.55) saturate(1.15)",
              opacity: live ? 1 : 0
            }}
          />

          {/* At 1x this shows the whole frame (contain), letterboxed over the
              blurred backdrop rather than cropped — that's the zoomed-out
              default for both portrait and landscape. Zooming in blends
              toward a tight edge-to-edge fill, matching the capture math. */}
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: zoomCaps || zoom <= 1 ? "contain" : "cover",
              // A hardware-zoomed track already reflects that zoom in its
              // pixels; adding the CSS scale on top would double it.
              transform: `${facing === "user" ? "scaleX(-1) " : ""}${zoomCaps ? "" : `scale(${zoom})`}`,
              opacity: live ? 1 : 0
            }}
          />

          {live && (
            <>
              <button
                onClick={() => setShowStrip(true)}
                disabled={busy}
                aria-label={`View your strip, ${shotCount} of ${SHOT_COUNT} frames shot`}
                style={{ ...overlayIconBtn, position: "absolute", top: 12, left: 12, opacity: busy ? 0.4 : 1 }}
              >
                <StripIcon />
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    bottom: -4,
                    right: -4,
                    minWidth: 17,
                    height: 17,
                    padding: "0 3px",
                    borderRadius: 999,
                    background: p.lamp,
                    color: "#160f13",
                    fontSize: 9.5,
                    fontWeight: 800,
                    lineHeight: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  {shotCount}/{SHOT_COUNT}
                </span>
              </button>

              <div
                style={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  display: "flex",
                  gap: 6,
                  padding: 4,
                  borderRadius: 999,
                  background: "rgba(10,6,9,0.55)",
                  backdropFilter: "blur(3px)",
                  border: "1px solid rgba(255,255,255,0.14)"
                }}
              >
                <button
                  onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
                  disabled={busy}
                  aria-label="Switch between front and back camera"
                  style={{ ...overlayPillBtn, opacity: busy ? 0.4 : 1 }}
                >
                  <FlipIcon />
                </button>
                <button
                  onClick={() => setOrientation((o) => (o === "portrait" ? "landscape" : "portrait"))}
                  disabled={busy}
                  aria-label={`Switch to ${orientation === "portrait" ? "landscape" : "portrait"} capture`}
                  aria-pressed={orientation === "landscape"}
                  style={{ ...overlayPillBtn, opacity: busy ? 0.4 : 1 }}
                >
                  <OrientationIcon orientation={orientation} />
                </button>
              </div>
            </>
          )}

          {live &&
            (zoomCaps ? (
              <LensPills value={zoom} presets={zoomPresets(zoomCaps)} disabled={busy} onSelect={setZoomValue} />
            ) : (
              <ZoomStepper value={zoom} disabled={busy} onAdjust={(delta) => setZoomValue(zoom + delta)} />
            ))}

          {countdown !== null && (
            <div
              aria-live="polite"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(10,6,9,0.28)",
                pointerEvents: "none"
              }}
            >
              <span
                key={countdown}
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "min(34vw, 190px)",
                  fontWeight: 700,
                  lineHeight: 1,
                  color: "var(--paper)",
                  textShadow: `0 0 40px ${p.lampGlow}, 0 6px 30px rgba(0,0,0,0.6)`,
                  animation: "count-pop 320ms ease-out both"
                }}
              >
                {countdown}
              </span>
            </div>
          )}

          {flash && (
            <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: 0.85 }} />
          )}

          {!live && (
            <PermissionGate perm={perm} errorMsg={errorMsg} team={team} onRequest={startCamera} />
          )}

          {showStrip && (
            <StripPreviewOverlay
              team={team}
              photos={photos}
              orientation={orientation}
              onSelect={selectFrame}
              onClose={() => setShowStrip(false)}
            />
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------ controls */}
      <div style={{ padding: "14px 18px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, alignItems: "center" }}>
          <ModeSwitch mode={mode} disabled={busy} onChange={setMode} team={team} />
          {mode === "timer" && (
            <TimerStepper value={timerSec} disabled={busy} onAdjust={adjustTimer} />
          )}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            gap: 12
          }}
        >
          {/* Left cell is intentionally empty — flip, orientation and the
              strip viewer all live on the viewfinder itself now. Keeping the
              cell keeps the shutter centered against the print button. */}
          <div aria-hidden />

          {busy ? (
            <button onClick={cancelSequence} style={shutterBase}>
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 24,
                  borderRadius: 5,
                  background: "var(--paper)",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.5)"
                }}
              />
              <span className="sr-only">Stop the countdown</span>
            </button>
          ) : (
            <button
              onClick={handleShutter}
              disabled={!live}
              aria-label={
                mode === "timer" ? `Start ${timerSec} second countdown` : "Take a photo now"
              }
              style={{
                ...shutterBase,
                opacity: live ? 1 : 0.35
              }}
            />
          )}

          <div style={{ justifySelf: "end" }}>
            <button
              onClick={onDone}
              disabled={!rollComplete}
              className="plate"
              style={{
                opacity: rollComplete ? 1 : 0.28,
                transform: rollComplete ? "none" : "none"
              }}
            >
              Print strip
            </button>
          </div>
        </div>

        <p
          style={{
            margin: 0,
            textAlign: "center",
            fontSize: 12.5,
            opacity: 0.5,
            minHeight: 18,
            lineHeight: 1.4
          }}
        >
          {busy
            ? "Hold still — tap the square to stop."
            : rollComplete
            ? "Roll finished. Open your strip to shoot a frame again."
            : mode === "timer"
            ? "The booth shoots the rest of the roll on its own."
            : "Tap the red button for each frame."}
        </p>
      </div>

      <style>{`
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

/**
 * The full roll as a slide-out overlay, stacked in print order at the real
 * capture aspect ratio — an honest preview of the strip, not an abstract
 * thumbnail. Tapping any frame arms it for a retake and returns to the
 * viewfinder.
 */
function StripPreviewOverlay({
  team,
  photos,
  orientation,
  onSelect,
  onClose
}: {
  team: Team;
  photos: Slot[];
  orientation: CaptureOrientation;
  onSelect: (i: number) => void;
  onClose: () => void;
}) {
  const p = PALETTE[team];
  const ratio = `${CAPTURE_DIMS[orientation].w} / ${CAPTURE_DIMS[orientation].h}`;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(180deg, rgba(20,13,18,0.98), rgba(10,6,9,0.99))"
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          flex: "0 0 auto"
        }}
      >
        <span className="plate">Your strip</span>
        <button onClick={onClose} aria-label="Close strip preview" style={roundBtn}>
          <CloseIcon />
        </button>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "4px 20px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          alignItems: "center"
        }}
      >
        {photos.map((src, i) => (
          <button
            key={i}
            onClick={() => onSelect(i)}
            aria-label={src ? `Retake frame ${i + 1}` : `Shoot frame ${i + 1}`}
            style={{
              width: "100%",
              maxWidth: 340,
              aspectRatio: ratio,
              borderRadius: 14,
              overflow: "hidden",
              position: "relative",
              padding: 0,
              flex: "0 0 auto",
              background: "#120c10",
              border: src ? "1px solid rgba(244,235,221,0.16)" : `2px dashed ${p.lamp}88`
            }}
          >
            {src ? (
              <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13.5,
                  opacity: 0.6,
                  textAlign: "center",
                  padding: 16
                }}
              >
                Tap to shoot frame {i + 1}
              </span>
            )}
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: 10,
                left: 10,
                minWidth: 24,
                height: 24,
                padding: "0 6px",
                borderRadius: "50%",
                background: "rgba(10,6,9,0.72)",
                border: "1px solid rgba(244,235,221,0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700
              }}
            >
              {i + 1}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ModeSwitch({
  mode,
  disabled,
  onChange,
  team
}: {
  mode: CaptureMode;
  disabled: boolean;
  onChange: (m: CaptureMode) => void;
  team: Team;
}) {
  const p = PALETTE[team];
  const opt = (value: CaptureMode, label: string) => {
    const on = mode === value;
    return (
      <button
        key={value}
        onClick={() => onChange(value)}
        disabled={disabled}
        aria-pressed={on}
        style={{
          padding: "8px 16px",
          borderRadius: 999,
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "0.01em",
          color: on ? "#160f13" : "var(--paper)",
          background: on ? p.lamp : "transparent",
          opacity: disabled ? 0.5 : 1
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      role="group"
      aria-label="Capture mode"
      style={{
        display: "flex",
        padding: 3,
        borderRadius: 999,
        background: "rgba(0,0,0,0.35)",
        border: "1px solid rgba(244,235,221,0.12)"
      }}
    >
      {opt("instant", "Now")}
      {opt("timer", "Timer")}
    </div>
  );
}

function TimerStepper({
  value,
  disabled,
  onAdjust
}: {
  value: number;
  disabled: boolean;
  onAdjust: (delta: number) => void;
}) {
  const btn = (delta: number, label: string, glyph: string) => (
    <button
      onClick={() => onAdjust(delta)}
      disabled={disabled || (delta < 0 ? value <= TIMER_MIN : value >= TIMER_MAX)}
      aria-label={label}
      style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        fontSize: 17,
        lineHeight: 1,
        color: "var(--paper)",
        background: "rgba(244,235,221,0.1)",
        opacity: disabled || (delta < 0 ? value <= TIMER_MIN : value >= TIMER_MAX) ? 0.3 : 1
      }}
    >
      {glyph}
    </button>
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 6px",
        borderRadius: 999,
        background: "rgba(0,0,0,0.35)",
        border: "1px solid rgba(244,235,221,0.12)"
      }}
    >
      {btn(-1, "Shorten the countdown", "−")}
      <span
        aria-live="polite"
        style={{
          minWidth: 34,
          textAlign: "center",
          fontSize: 14,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums"
        }}
      >
        {value}s
      </span>
      {btn(1, "Lengthen the countdown", "+")}
    </div>
  );
}

/** A floating pill over the viewfinder — zoom is framing, not a booth
    setting, so it lives on the preview itself rather than the control row. */
function ZoomStepper({
  value,
  disabled,
  onAdjust
}: {
  value: number;
  disabled: boolean;
  onAdjust: (delta: number) => void;
}) {
  const btn = (delta: number, label: string, glyph: string) => (
    <button
      onClick={() => onAdjust(delta)}
      disabled={disabled || (delta < 0 ? value <= ZOOM_MIN : value >= ZOOM_MAX)}
      aria-label={label}
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        fontSize: 16,
        lineHeight: 1,
        color: "var(--paper)",
        background: "rgba(255,255,255,0.14)",
        opacity: disabled || (delta < 0 ? value <= ZOOM_MIN : value >= ZOOM_MAX) ? 0.35 : 1
      }}
    >
      {glyph}
    </button>
  );

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 14,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 6px",
        borderRadius: 999,
        background: "rgba(10,6,9,0.55)",
        backdropFilter: "blur(3px)",
        border: "1px solid rgba(255,255,255,0.14)"
      }}
    >
      {btn(-ZOOM_STEP, "Zoom out", "−")}
      <span
        aria-live="polite"
        style={{
          minWidth: 34,
          textAlign: "center",
          fontSize: 13,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums"
        }}
      >
        {value.toFixed(1)}x
      </span>
      {btn(ZOOM_STEP, "Zoom in", "+")}
    </div>
  );
}

/** Lens-style stops (.5x/1x/2x…) for cameras that expose real hardware zoom,
    mirroring the native camera app instead of a free +/- stepper. */
function LensPills({
  value,
  presets,
  disabled,
  onSelect
}: {
  value: number;
  presets: number[];
  disabled: boolean;
  onSelect: (v: number) => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 14,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 6px",
        borderRadius: 999,
        background: "rgba(10,6,9,0.55)",
        backdropFilter: "blur(3px)",
        border: "1px solid rgba(255,255,255,0.14)"
      }}
    >
      {presets.map((v) => {
        const on = Math.abs(v - value) < 0.05;
        return (
          <button
            key={v}
            onClick={() => onSelect(v)}
            disabled={disabled}
            aria-pressed={on}
            aria-label={`${v}x lens`}
            style={{
              minWidth: 30,
              height: 26,
              padding: "0 8px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              color: on ? "#160f13" : "var(--paper)",
              background: on ? "var(--paper)" : "transparent",
              opacity: disabled ? 0.4 : 1
            }}
          >
            {v}×
          </button>
        );
      })}
    </div>
  );
}

function PermissionGate({
  perm,
  errorMsg,
  team,
  onRequest
}: {
  perm: PermState;
  errorMsg: string;
  team: Team;
  onRequest: () => void;
}) {
  const p = PALETTE[team];

  const body =
    perm === "denied"
      ? "Camera access is switched off for this site. Turn it on in your browser settings, then tap below."
      : perm === "error"
      ? errorMsg
      : "The booth needs your camera to expose the film. Photos stay on this phone.";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 26,
        textAlign: "center",
        background: "linear-gradient(180deg, #221820 0%, #140d12 100%)"
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 25,
          fontWeight: 700,
          lineHeight: 1.15
        }}
      >
        {perm === "denied" ? "The lens is covered" : "Open the lens"}
      </div>
      <p style={{ fontSize: 13.5, opacity: 0.62, maxWidth: "30ch", lineHeight: 1.55, margin: 0 }}>
        {body}
      </p>
      <button
        onClick={onRequest}
        disabled={perm === "requesting"}
        style={{
          marginTop: 4,
          padding: "12px 26px",
          borderRadius: 999,
          fontSize: 15,
          fontWeight: 600,
          color: "#160f13",
          background: p.lamp,
          opacity: perm === "requesting" ? 0.6 : 1
        }}
      >
        {perm === "requesting" ? "Opening" : "Open the lens"}
      </button>
    </div>
  );
}

function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 5 8 12l7 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6l12 12M18 6 6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A small stack-of-photos glyph for the "view your strip" header button. */
function StripIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="7" y="3" width="12" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
      <rect x="5" y="8" width="12" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
      <rect x="3" y="13" width="12" height="8" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function OrientationIcon({ orientation }: { orientation: CaptureOrientation }) {
  const portrait = orientation === "portrait";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x={portrait ? 6 : 3}
        y={portrait ? 3 : 6}
        width={portrait ? 12 : 18}
        height={portrait ? 18 : 12}
        rx={2.5}
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 11a8 8 0 0 0-13.7-5.6L4 7.6M4 13a8 8 0 0 0 13.7 5.6L20 16.4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 4v3.8h3.8M20 20v-3.8h-3.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const roundBtn: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: "50%",
  background: "rgba(244,235,221,0.1)",
  color: "var(--paper)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center"
};

/** A round control floating directly on the video, so it needs its own
    contrast (dark + blurred) rather than the header's light chrome look. */
const overlayIconBtn: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: "50%",
  background: "rgba(10,6,9,0.55)",
  backdropFilter: "blur(3px)",
  border: "1px solid rgba(255,255,255,0.14)",
  color: "var(--paper)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center"
};

/** A button nested inside an already-dark overlay pill (the flip/orientation
    group), so it only needs a lighter fill, not its own border. */
const overlayPillBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: "50%",
  background: "rgba(255,255,255,0.14)",
  color: "var(--paper)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center"
};

/** The one loud object in the booth: a lacquered shutter. */
const shutterBase: React.CSSProperties = {
  position: "relative",
  width: 74,
  height: 74,
  borderRadius: "50%",
  background: "radial-gradient(circle at 34% 28%, #e8615a, var(--lacquer) 52%, var(--lacquer-dim))",
  boxShadow:
    "0 0 0 5px rgba(244,235,221,0.9), 0 0 0 7px rgba(0,0,0,0.35), 0 10px 20px -8px rgba(0,0,0,0.8)"
};
