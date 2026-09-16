"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyGrain,
  canvasToBlob,
  drawBubbleText,
  drawCloudBand,
  drawImageCover,
  ensureStripFonts,
  loadImage,
  roundedRectPath,
  withShadow
} from "@/lib/canvas";
import { PALETTE, type Team } from "@/lib/types";

/* Card geometry: a cloud-trimmed header and footer bracketing a plain
   vertical stack of frames — no overlap, no rotation, one frame after
   another with a clean gutter between them. */
const CARD_W = 900;
const CORNER_R = 0;
const BORDER_W = 16;

const HEADER_H = 300;
const FOOTER_H = 280;
/** Space between the last frame and the footer, mirroring the header's gap. */
const STACK_FOOTER_GAP = 40;

const PHOTO_W = 660;
const PHOTO_H = 780;
const GUTTER = 28;

const CREAM = "#fff7e8";
const WHITE = "#ffffff";
const GIRL_PINK = PALETTE.girl.lamp;
const BOY_BLUE = PALETTE.boy.lamp;

/**
 * One framed photo: a fully opaque white backing behind a cover-cropped
 * photo, so the print reads as a clean set of snapshots rather than the
 * photo's raw edges.
 */
function drawFramedPhoto(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const frame = 20;

  withShadow(ctx, () => {
    roundedRectPath(ctx, x, y, w, h, 14);
    ctx.fillStyle = "#fffdf7";
    ctx.fill();
  });

  const ix = x + frame;
  const iy = y + frame;
  const iw = w - frame * 2;
  const ih = h - frame * 2;

  ctx.save();
  roundedRectPath(ctx, ix, iy, iw, ih, 8);
  ctx.clip();
  drawImageCover(ctx, img, ix, iy, iw, ih);

  ctx.globalCompositeOperation = "soft-light";
  ctx.fillStyle = "rgba(255, 206, 150, 0.22)";
  ctx.fillRect(ix, iy, iw, ih);
  ctx.globalCompositeOperation = "source-over";
  applyGrain(ctx, ix, iy, iw, ih, 0.14);
  ctx.restore();

  ctx.save();
  roundedRectPath(ctx, ix + 0.5, iy + 0.5, iw - 1, ih - 1, 8);
  ctx.strokeStyle = "rgba(36,28,31,0.16)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/**
 * The team-tag ribbon: a pennant-notched banner pinned across a corner and
 * tilted, like a strip of washi tape laid diagonally over the photo.
 */
function drawRibbonBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angleDeg: number,
  text: string,
  bg: string,
  fg: string
): void {
  const w = 260;
  const h = 46;
  const notch = 14;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((angleDeg * Math.PI) / 180);

  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  ctx.lineTo(w / 2 - notch, 0);
  ctx.lineTo(w / 2, h / 2);
  ctx.lineTo(-w / 2, h / 2);
  ctx.lineTo(-w / 2 + notch, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '800 26px "Archivo", sans-serif';
  ctx.fillText(text, 0, 1);

  ctx.restore();
}

/* Sticker artwork ---------------------------------------------------------
   Each PNG has its green screen keyed out ahead of time (see the sticker
   source notes) so only the illustration itself is opaque. They're loaded
   once and cached, since they're static assets shared by every strip. */
const STICKER_SRCS = [
  "/stickers/rainbow-clouds.png",
  "/stickers/flowers-red.png",
  "/stickers/mushrooms.png",
  "/stickers/flower-smiley.png",
  "/stickers/flower-plain.png",
  "/stickers/balloon-dog.png",
  "/stickers/balloons-star.png",
  "/stickers/question-bows.png",
  "/stickers/question-balloon.png"
] as const;

type StickerSrc = (typeof STICKER_SRCS)[number];

let stickerImagesPromise: Promise<Record<StickerSrc, HTMLImageElement | null>> | null = null;

function loadStickerImages(): Promise<Record<StickerSrc, HTMLImageElement | null>> {
  if (!stickerImagesPromise) {
    const attempt = Promise.all(STICKER_SRCS.map((src) => loadImage(src))).then((imgs) => {
      const map = {} as Record<StickerSrc, HTMLImageElement | null>;
      STICKER_SRCS.forEach((src, i) => (map[src] = imgs[i]));
      // A transient failure (a flaky connection on a party phone) shouldn't
      // blank the stickers out for the rest of the session — only a fully
      // successful load is worth remembering; anything else clears the
      // cache so the next strip render tries again.
      if (imgs.some((img) => !img)) stickerImagesPromise = null;
      return map;
    });
    stickerImagesPromise = attempt;
  }
  return stickerImagesPromise;
}

type StickerSpec = { src: StickerSrc; cx: number; cy: number; w: number; rotateDeg: number };

/**
 * Where each sticker sits. The margin beside the photo stack is only
 * PAD = (CARD_W - PHOTO_W) / 2 = 120px wide, so a sticker big enough to read
 * as "bigger" has to lean into the photo's edge — every position here is
 * solved so the sticker's own rotated bounding box never crosses the card's
 * outer edge (which would silently clip it), while the overlap onto the
 * photo stays under the 55% ceiling the design keeps everywhere else.
 */
function stickerLayout(footerY: number): StickerSpec[] {
  const photoCenterY = (i: number) => HEADER_H + i * (PHOTO_H + GUTTER) + PHOTO_H / 2;
  return [
    { src: "/stickers/rainbow-clouds.png", cx: 740, cy: 300, w: 260, rotateDeg: 6 },
    { src: "/stickers/flowers-red.png", cx: 115, cy: photoCenterY(0) - 90, w: 195, rotateDeg: -4 },
    { src: "/stickers/mushrooms.png", cx: 784, cy: photoCenterY(0) + 60, w: 195, rotateDeg: 4 },
    { src: "/stickers/flower-smiley.png", cx: 115, cy: photoCenterY(1) - 100, w: 195, rotateDeg: -4 },
    { src: "/stickers/flower-plain.png", cx: 784, cy: photoCenterY(1) + 90, w: 195, rotateDeg: 4 },
    { src: "/stickers/balloon-dog.png", cx: 115, cy: photoCenterY(2) - 60, w: 195, rotateDeg: -4 },
    { src: "/stickers/balloons-star.png", cx: 784, cy: photoCenterY(2) + 80, w: 195, rotateDeg: 4 },
    { src: "/stickers/question-bows.png", cx: 145, cy: footerY - 38, w: 240, rotateDeg: 6 },
    { src: "/stickers/question-balloon.png", cx: 755, cy: footerY - 38, w: 240, rotateDeg: -6 }
  ];
}

/** Draws a sticker centered on (cx, cy), rotated, at a fixed display width
    with its natural aspect ratio preserved. */
function drawSticker(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  w: number,
  rotateDeg: number
): void {
  const ratio = img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1.5;
  const h = w * ratio;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotateDeg * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
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

    const stackH = PHOTO_H * photos.length + GUTTER * (photos.length - 1);
    const height = HEADER_H + stackH + STACK_FOOTER_GAP + FOOTER_H;
    canvas.width = CARD_W;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setFailed(true);
      return;
    }

    await ensureStripFonts();
    const [images, stickers] = await Promise.all([loadFrames(photos), loadStickerImages()]);
    if (stale()) return;

    if (images.some((img) => !img)) {
      setFailed(true);
      return;
    }

    ctx.clearRect(0, 0, CARD_W, height);

    /* Card shell ---------------------------------------------------------
       Everything is clipped to one rounded rect so the panel colour, the
       cloud bands and the photo stack all share a single clean edge — no
       separate layers that could seam or double-paint at the border. */
    ctx.save();
    roundedRectPath(ctx, 0, 0, CARD_W, height, CORNER_R);
    ctx.clip();

    ctx.fillStyle = p.lamp;
    ctx.fillRect(0, 0, CARD_W, height);
    applyGrain(ctx, 0, 0, CARD_W, height, 0.05);

    /* Photo stack ---------------------------------------------------------
       Plain vertical order, each frame fully opaque and separated by a
       gutter — nothing overlaps, so there's no seam for a later frame to
       have to cover. */
    const photoX = (CARD_W - PHOTO_W) / 2;
    images.forEach((img, i) => {
      if (!img) return;
      const y = HEADER_H + i * (PHOTO_H + GUTTER);
      drawFramedPhoto(ctx, img, photoX, y, PHOTO_W, PHOTO_H);
    });

    /* Stickers -----------------------------------------------------------
       Drawn after the photos (so they can graze a photo's edge) but before
       the header/footer clouds (so a sticker that strays into either band
       tucks under it, same as the ribbon). A missing sticker is skipped
       quietly — decoration, unlike a blank frame, is never worth failing
       the whole strip over. */
    const footerY = height - FOOTER_H;
    for (const s of stickerLayout(footerY)) {
      const img = stickers[s.src];
      if (!img) continue;
      withShadow(ctx, () => drawSticker(ctx, img, s.cx, s.cy, s.w, s.rotateDeg));
    }

    /* Cloud header ---------------------------------------------------------
       The solid cream field ends at HEADER_FLAT_H (well under the title's
       lowest descender), and only the decorative puff fringe below that is
       scalloped — so no letter ever straddles a cream/panel seam. */
    const HEADER_CLOUD_R = 44;
    const HEADER_FLAT_H = 214;
    drawCloudBand(
      ctx,
      -8,
      -8,
      CARD_W + 16,
      HEADER_FLAT_H + HEADER_CLOUD_R * 0.7 + 8,
      HEADER_CLOUD_R,
      CREAM,
      1
    );

    withShadow(ctx, () => drawBubbleText(ctx, "Gender", CARD_W / 2, 92, 88, GIRL_PINK, CREAM, 14));
    withShadow(ctx, () => drawBubbleText(ctx, "Reveal!", CARD_W / 2, 178, 78, BOY_BLUE, CREAM, 14));

    /* Team ribbon ---------------------------------------------------------
       Tucked into the top-left of the cloud header, tilted like a strip of
       washi tape laid across the corner. */
    const teamLabel = team === "boy" ? "#TEAMBOY" : "#TEAMGIRL";
    withShadow(ctx, () => drawRibbonBadge(ctx, 105, 105, -35, teamLabel, p.lampDeep, CREAM));

    /* Cloud footer -----------------------------------------------------
       Mirrors the header, but in plain white rather than cream, with the
       classic cursive keepsake note instead of any sticker or badge. */
    const FOOTER_CLOUD_R = 44;
    const FOOTER_FLAT_TOP = footerY + 40;
    const footerBandY = FOOTER_FLAT_TOP - FOOTER_CLOUD_R * 0.7;
    drawCloudBand(
      ctx,
      -8,
      footerBandY,
      CARD_W + 16,
      height + 8 - footerBandY,
      FOOTER_CLOUD_R,
      WHITE,
      -1
    );

    ctx.textAlign = "center";

    const thankYouY = height - 150;
    ctx.fillStyle = p.lampDeep;
    ctx.font = '400 68px "Great Vibes", "Brush Script MT", cursive';
    ctx.fillText("Thank you for coming", CARD_W / 2, thankYouY);

    ctx.fillStyle = "rgba(36,28,31,0.72)";
    ctx.font = '400 42px "Great Vibes", "Brush Script MT", cursive';
    ctx.fillText("September 20, 2026", CARD_W / 2, height - 96);

    ctx.fillStyle = "rgba(36,28,31,0.6)";
    ctx.font = '400 36px "Great Vibes", "Brush Script MT", cursive';
    ctx.fillText("~ mommy she & daddy bri", CARD_W / 2, height - 46);

    /* Outer trim: a cream keyline just inside the card edge, echoing a
       ticket's perforation without needing a real dashed cut line. */
    ctx.save();
    roundedRectPath(ctx, BORDER_W / 2, BORDER_W / 2, CARD_W - BORDER_W, height - BORDER_W, CORNER_R);
    ctx.strokeStyle = CREAM;
    ctx.lineWidth = BORDER_W;
    ctx.stroke();
    ctx.setLineDash([2, 14]);
    ctx.lineCap = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(44,33,24,0.35)";
    roundedRectPath(
      ctx,
      BORDER_W + 10,
      BORDER_W + 10,
      CARD_W - (BORDER_W + 10) * 2,
      height - (BORDER_W + 10) * 2,
      CORNER_R * 0.7
    );
    ctx.stroke();
    ctx.restore();

    ctx.restore(); // card-shell clip

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
