"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyGrain,
  canvasToBlob,
  drawBalloon,
  drawBow,
  drawFlower,
  drawHeart,
  drawLollipop,
  drawStar,
  drawTeddyBear,
  ensureStripFonts,
  loadImage,
  roundedRectPath,
  withShadow,
  type Motif
} from "@/lib/canvas";
import { PALETTE, type Team } from "@/lib/types";

/* Strip geometry — the 1:4 proportion of a real booth strip. Wider side
   gutters than a plain print, because this booth trims its border with
   party-favor stickers instead of leaving it bare. */
const CELL_W = 900;
const CELL_H = 1200;
const GUTTER = 20;
const PAD_X = 96;
const PAD_TOP = 268;
const PAD_BOTTOM = 236;
const LAMP_BAND = 12;

const STRIP_W = CELL_W + PAD_X * 2;

const GOLD = "#e8c46d";

/** Team Girl gets a garden; Team Boy gets a toy box. Each set is four motifs
    so corner/garland placement can cycle through them without repeats. */
function teamMotifs(team: Team): Motif[] {
  if (team === "girl") {
    return [
      (ctx, x, y, s) => drawFlower(ctx, x, y, s, "#ffb8d4", GOLD),
      (ctx, x, y, s) => drawBow(ctx, x, y, s, "#ff6fa8"),
      (ctx, x, y, s) => drawLollipop(ctx, x, y, s, "#ff9dc0", "#fff3e6"),
      (ctx, x, y, s) => drawHeart(ctx, x, y, s, "#e85a92")
    ];
  }
  return [
    (ctx, x, y, s) => drawTeddyBear(ctx, x, y, s, "#c69569"),
    (ctx, x, y, s) => drawBalloon(ctx, x, y, s, "#4fb3ff"),
    (ctx, x, y, s) => drawStar(ctx, x, y, s, GOLD),
    (ctx, x, y, s) => drawLollipop(ctx, x, y, s, "#7fc4ff", "#ffffff")
  ];
}

export default function StripResult({
  team,
  photos,
  onStartOver
}: {
  team: Team;
  photos: string[];
  onStartOver: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderIdRef = useRef(0);
  // A blob: URL, built once the strip is drawn, kept only for saving/sharing.
  // Chrome blocks a *data:* URL from opening as its own tab (an anti-phishing
  // rule, since data: URLs carry no origin) — a blob: URL is exempt because
  // it's tied to this page's origin, which is what lets the save button open
  // the strip as a real page instead of a dead tab.
  const stripBlobRef = useRef<{ blob: Blob; url: string } | null>(null);

  const [stripUrl, setStripUrl] = useState("");
  const [saveReady, setSaveReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [note, setNote] = useState("");
  // navigator.share doesn't exist during SSR, and its presence still isn't a
  // guarantee of file support — but it's enough to decide whether the Share
  // button is worth offering at all.
  const [shareSupported, setShareSupported] = useState(false);

  useEffect(() => {
    setShareSupported(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const p = PALETTE[team];

  const drawStrip = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Every draw claims a ticket. Strict Mode mounts effects twice and this
    // function awaits, so without the ticket two passes interleave on one
    // canvas — that was the ghosting and doubled shadows in the old strip.
    const ticket = ++renderIdRef.current;
    const stale = () => renderIdRef.current !== ticket;

    setFailed(false);
    setSaveReady(false);

    const height = PAD_TOP + CELL_H * photos.length + GUTTER * (photos.length - 1) + PAD_BOTTOM;
    canvas.width = STRIP_W;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setFailed(true);
      return;
    }

    await ensureStripFonts();
    const images = await loadFrames(photos);
    if (stale()) return;

    if (images.some((img) => !img)) {
      setFailed(true);
      return;
    }

    ctx.clearRect(0, 0, STRIP_W, height);

    /* Paper stock ------------------------------------------------------- */
    const paper = ctx.createLinearGradient(0, 0, 0, height);
    paper.addColorStop(0, "#f6eee2");
    paper.addColorStop(1, "#eadfcd");
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, STRIP_W, height);
    applyGrain(ctx, 0, 0, STRIP_W, height, 0.4);

    // One lamp band at the head of the strip. The original also banded the
    // foot and ringed every frame; a single accent reads as printed, not busy.
    ctx.fillStyle = p.lamp;
    ctx.fillRect(0, 0, STRIP_W, LAMP_BAND);

    /* Head — the reveal, and nothing competing with it. --------------- */
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
    ctx.fillStyle = p.lampDeep;
    ctx.font = '700 98px "Fraunces", Georgia, serif';
    ctx.fillText(p.word, STRIP_W / 2, 172);

    const motifs = teamMotifs(team);

    // A small garland under the title — the only ornament that isn't
    // anchored to a frame, so it reads as a header rather than a sticker.
    const garlandY = 226;
    const garlandOrder = [1, 2, 0, 3, 1];
    const garlandGap = 78;
    garlandOrder.forEach((m, i) => {
      const gx = STRIP_W / 2 + (i - (garlandOrder.length - 1) / 2) * garlandGap;
      withShadow(ctx, () => motifs[m](ctx, gx, garlandY, 38));
    });

    /* Frames ------------------------------------------------------------ */
    images.forEach((img, i) => {
      if (!img) return;
      const x = PAD_X;
      const y = PAD_TOP + i * (CELL_H + GUTTER);

      ctx.save();
      roundedRectPath(ctx, x, y, CELL_W, CELL_H, 10);
      ctx.clip();

      ctx.drawImage(img, x, y, CELL_W, CELL_H);

      // Warm the print the way booth chemistry does, then match the paper's
      // tooth so the photo sits in the page rather than on top of it.
      ctx.globalCompositeOperation = "soft-light";
      ctx.fillStyle = "rgba(255, 206, 150, 0.22)";
      ctx.fillRect(x, y, CELL_W, CELL_H);
      ctx.globalCompositeOperation = "source-over";
      applyGrain(ctx, x, y, CELL_W, CELL_H, 0.16);

      ctx.restore();

      ctx.save();
      roundedRectPath(ctx, x + 0.5, y + 0.5, CELL_W - 1, CELL_H - 1, 10);
      ctx.strokeStyle = "rgba(36,28,31,0.16)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Side-gutter trim: small motifs live entirely in the paper margin,
      // never touching the photo.
      const leftX = PAD_X / 2;
      const rightX = STRIP_W - PAD_X / 2;
      const gutterMotif = motifs[i % motifs.length];
      const gutterAlt = motifs[(i + 2) % motifs.length];
      withShadow(ctx, () => gutterMotif(ctx, leftX, y + CELL_H * 0.28, 52));
      withShadow(ctx, () => gutterAlt(ctx, leftX, y + CELL_H * 0.72, 52));
      withShadow(ctx, () => gutterAlt(ctx, rightX, y + CELL_H * 0.28, 52));
      withShadow(ctx, () => gutterMotif(ctx, rightX, y + CELL_H * 0.72, 52));

      // Corner stickers: centered on the frame's own corner so most of the
      // icon sits in the border and only a small crescent laps onto the
      // photo — never more than a sliver of the picture itself.
      const cornerA = motifs[(i * 2) % motifs.length];
      const cornerB = motifs[(i * 2 + 1) % motifs.length];
      withShadow(ctx, () => cornerA(ctx, x, y, 92));
      withShadow(ctx, () => cornerB(ctx, x + CELL_W, y + CELL_H, 92));
    });

    /* Foot — a keepsake note rather than booth signage. ----------------- */
    ctx.textAlign = "center";

    const thankYouY = height - 150;
    const dividerY = height - PAD_BOTTOM + 34;
    withShadow(ctx, () => motifs[3](ctx, STRIP_W / 2, dividerY, 44));

    ctx.fillStyle = p.lampDeep;
    ctx.font = '400 68px "Great Vibes", "Brush Script MT", cursive';
    ctx.fillText("Thank you for coming", STRIP_W / 2, thankYouY);
    // motifs[1] is skipped here — it's what the last frame's bottom-right
    // corner sticker already uses, and that sticker sits just above-right
    // of this spot, so reusing it would read as one icon drawn twice.
    withShadow(ctx, () => motifs[0](ctx, PAD_X * 0.62, thankYouY - 16, 44));
    withShadow(ctx, () => motifs[2](ctx, STRIP_W - PAD_X * 0.62, thankYouY - 16, 44));

    ctx.fillStyle = "rgba(36,28,31,0.72)";
    ctx.font = '400 42px "Great Vibes", "Brush Script MT", cursive';
    ctx.fillText(formatDate(), STRIP_W / 2, height - 96);

    ctx.fillStyle = "rgba(36,28,31,0.6)";
    ctx.font = '400 36px "Great Vibes", "Brush Script MT", cursive';
    ctx.fillText("~ mommy she & daddy bri", STRIP_W / 2, height - 46);

    if (stale()) return;
    setStripUrl(canvas.toDataURL("image/jpeg", 0.95));

    const blob = await canvasToBlob(canvas);
    if (stale() || !blob) return;
    const url = URL.createObjectURL(blob);
    const prev = stripBlobRef.current;
    stripBlobRef.current = { blob, url };
    if (prev) URL.revokeObjectURL(prev.url);
    setSaveReady(true);
  }, [p.lamp, p.lampDeep, p.word, photos]);

  useEffect(() => {
    drawStrip();
    // Bump the ticket on teardown so an in-flight pass can't paint over a
    // canvas that a newer pass already owns.
    return () => {
      renderIdRef.current += 1;
      if (stripBlobRef.current) URL.revokeObjectURL(stripBlobRef.current.url);
      stripBlobRef.current = null;
    };
  }, [drawStrip]);

  // Opening the strip as its own page — rather than forcing a download —
  // lets a long-press (iOS) or a right-click (everywhere else) save it,
  // which works with no download manager at all. That's the fallback every
  // action below reaches for when its first choice isn't available.
  const openInNewTab = (url: string, guidance: string) => {
    const win = window.open(url, "_blank");
    setNote(win ? guidance : "Allow pop-ups for this site, then try again.");
  };

  const handleSave = () => {
    const cached = stripBlobRef.current;
    if (!cached) return;
    setNote("");

    // A real disk save: works in an ordinary desktop or Android tab. iOS has
    // no download manager once this app is on the home screen, and even in
    // a normal Safari tab the file lands in Files, not Photos — that's what
    // the Share button is for, not this one.
    const a = document.createElement("a");
    a.href = cached.url;
    a.download = "reveal-booth-strip.jpg";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleShare = async () => {
    const cached = stripBlobRef.current;
    if (!cached || !shareSupported) return;
    setNote("");

    setSharing(true);
    try {
      const file = new File([cached.blob], "reveal-booth-strip.jpg", { type: "image/jpeg" });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "Reveal Booth",
          text: p.word
        });
      } else {
        openInNewTab(cached.url, "Opened in a new tab — press and hold the photo to save it.");
      }
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") {
        openInNewTab(cached.url, "Opened in a new tab — press and hold the photo to save it.");
      }
    } finally {
      setSharing(false);
    }
  };

  const handlePrint = () => {
    const cached = stripBlobRef.current;
    if (!cached) return;
    setNote("");

    // A bare `<img>` page, not the app shell, so the print dialog isn't
    // fighting the booth's dark curtain background and buttons for paper.
    const html = `<!doctype html><html><head><title>Reveal Booth Strip</title>
      <style>
        html, body { margin: 0; background: #fff; }
        img { display: block; width: 100%; height: auto; }
        @media print { @page { margin: 0; } }
      </style></head>
      <body><img src="${cached.url}" alt="Photo strip" /></body></html>`;
    const printUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));

    const win = window.open(printUrl, "_blank");
    if (!win) {
      setNote("Allow pop-ups for this site, then tap Print again.");
      URL.revokeObjectURL(printUrl);
      return;
    }
    win.addEventListener("load", () => {
      try {
        win.focus();
        win.print();
      } catch {
        /* The tab is still open with the image even if auto-print fails. */
      }
      setTimeout(() => URL.revokeObjectURL(printUrl), 4000);
    });
  };

  return (
    <div className="screen curtain">
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "18px 20px 8px"
        }}
      >
        {stripUrl ? (
          <img
            src={stripUrl}
            alt={`Photo strip, ${p.word}`}
            style={{
              maxHeight: "100%",
              maxWidth: "100%",
              width: "auto",
              height: "auto",
              borderRadius: 10,
              boxShadow: "0 26px 46px -22px rgba(0,0,0,0.85)",
              animation: "strip-drop 420ms ease-out both"
            }}
          />
        ) : (
          <p style={{ opacity: 0.55, fontSize: 14, textAlign: "center", maxWidth: "30ch" }}>
            {failed
              ? "A frame didn't develop. Go back and shoot the roll again."
              : "Developing your strip"}
          </p>
        )}
      </div>

      <div style={{ padding: "8px 20px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        {note && (
          <p style={{ textAlign: "center", fontSize: 12.5, opacity: 0.65, margin: 0 }}>{note}</p>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleSave}
            disabled={!saveReady}
            style={{
              ...actionBtnBase,
              color: "#3a2a10",
              background: "linear-gradient(180deg, #e8c46d 0%, var(--brass) 48%, var(--brass-dim) 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5), 0 6px 16px -8px rgba(0,0,0,0.8)",
              opacity: !saveReady ? 0.55 : 1
            }}
          >
            Save
          </button>

          <button
            onClick={handleShare}
            disabled={!saveReady || !shareSupported || sharing}
            style={{
              ...actionBtnBase,
              ...actionBtnSecondary,
              opacity: !saveReady || !shareSupported || sharing ? 0.4 : 1
            }}
          >
            {sharing ? "…" : "Share"}
          </button>

          <button
            onClick={handlePrint}
            disabled={!saveReady}
            style={{
              ...actionBtnBase,
              ...actionBtnSecondary,
              opacity: !saveReady ? 0.4 : 1
            }}
          >
            Print
          </button>
        </div>

        <button
          onClick={onStartOver}
          style={{
            padding: "13px",
            borderRadius: 12,
            fontSize: 14.5,
            fontWeight: 500,
            color: "var(--paper)",
            background: "rgba(244,235,221,0.07)",
            border: "1px solid rgba(244,235,221,0.16)"
          }}
        >
          Start over
        </button>
      </div>
    </div>
  );
}

const actionBtnBase: React.CSSProperties = {
  flex: 1,
  padding: "13px 8px",
  borderRadius: 12,
  fontSize: 14.5,
  fontWeight: 600,
  textAlign: "center"
};

const actionBtnSecondary: React.CSSProperties = {
  color: "var(--paper)",
  background: "rgba(232,196,109,0.1)",
  border: "1px solid rgba(232,196,109,0.35)"
};

function loadFrames(photos: string[]) {
  return Promise.all(photos.map((src) => loadImage(src)));
}

function formatDate() {
  try {
    return new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  } catch {
    return new Date().toDateString();
  }
}
