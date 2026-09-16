/**
 * Canvas helpers for printing the strip.
 *
 * Everything here is defensive: a party phone may have an old browser, a
 * blocked webfont, or a photo that failed to decode. None of those should
 * leave the guest staring at an empty screen.
 */

/** Loads an image, resolving to null instead of rejecting on failure. */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Waits for the webfonts the strip uses. Canvas silently falls back to a
 * system face if the font isn't in the font set yet, which is why the original
 * strip printed in plain sans-serif on a cold load.
 */
export async function ensureStripFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const faces = [
    '700 96px "Fraunces"',
    '600 30px "Archivo"',
    '500 28px "Archivo"',
    '600 22px "Archivo"',
    '400 68px "Great Vibes"'
  ];
  try {
    await Promise.all(faces.map((f) => document.fonts.load(f)));
    await document.fonts.ready;
  } catch {
    /* Fall through to system fonts rather than blocking the print. */
  }
}

/** Traces a rounded rectangle. Does not fill or stroke — caller decides. */
export function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

let grainTile: HTMLCanvasElement | null = null;

/**
 * A 96px monochrome noise tile, generated once and reused. Gives the paper and
 * the photos the tooth of a real chemical print.
 */
export function getGrainTile(): HTMLCanvasElement | null {
  if (grainTile) return grainTile;
  if (typeof document === "undefined") return null;

  const size = 96;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const tctx = tile.getContext("2d");
  if (!tctx) return null;

  const data = tctx.createImageData(size, size);
  for (let i = 0; i < data.data.length; i += 4) {
    const v = 110 + Math.random() * 90;
    data.data[i] = v;
    data.data[i + 1] = v;
    data.data[i + 2] = v;
    data.data[i + 3] = 255;
  }
  tctx.putImageData(data, 0, 0);
  grainTile = tile;
  return tile;
}

/** Lays grain over a region using the overlay blend, clipped by the caller. */
export function applyGrain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha: number
): void {
  const tile = getGrainTile();
  if (!tile) return;
  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern) return;

  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pattern;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/**
 * Draws tracked-out text. ctx.letterSpacing is not in every browser yet, so
 * fall back to positioning each glyph by hand.
 */
export function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  tracking: number
): void {
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };

  if (typeof spaced.letterSpacing === "string") {
    ctx.save();
    spaced.letterSpacing = `${tracking}px`;
    ctx.textAlign = "center";
    ctx.fillText(text, centerX, y);
    spaced.letterSpacing = "0px";
    ctx.restore();
    return;
  }

  const chars = Array.from(text);
  const width =
    chars.reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) + tracking * (chars.length - 1);

  ctx.save();
  ctx.textAlign = "left";
  let cursor = centerX - width / 2;
  for (const ch of chars) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + tracking;
  }
  ctx.restore();
}

/**
 * Party-favor motifs used to trim the strip's border. Every drawer is
 * centered on (cx, cy) and scaled by `size` alone, so callers can drop the
 * same icon at a garland size or a corner-sticker size without new math.
 */
export type Motif = (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) => void;

/** Casts a soft drop shadow under whatever the callback draws, then clears it. */
export function withShadow<T>(ctx: CanvasRenderingContext2D, draw: () => T): T {
  ctx.save();
  ctx.shadowColor = "rgba(20,12,10,0.3)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  const result = draw();
  ctx.restore();
  return result;
}

/** A six-petal blossom. */
export function drawFlower(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  petalColor: string,
  centerColor: string
): void {
  const petals = 6;
  const petalR = size * 0.34;
  const dist = size * 0.3;

  ctx.save();
  ctx.fillStyle = petalColor;
  for (let i = 0; i < petals; i++) {
    const angle = (i / petals) * Math.PI * 2;
    const px = cx + Math.cos(angle) * dist;
    const py = cy + Math.sin(angle) * dist;
    ctx.beginPath();
    ctx.ellipse(px, py, petalR, petalR * 0.7, angle, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = centerColor;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.19, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A ribbon bow, tails and all. */
export function drawBow(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const loop = size * 0.4;

  ctx.save();
  ctx.fillStyle = color;

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.bezierCurveTo(cx - loop, cy - loop * 0.95, cx - loop * 1.3, cy + loop * 0.5, cx, cy + loop * 0.1);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.bezierCurveTo(cx + loop, cy - loop * 0.95, cx + loop * 1.3, cy + loop * 0.5, cx, cy + loop * 0.1);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx - size * 0.05, cy + size * 0.08);
  ctx.lineTo(cx - size * 0.2, cy + size * 0.46);
  ctx.lineTo(cx - size * 0.02, cy + size * 0.36);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx + size * 0.05, cy + size * 0.08);
  ctx.lineTo(cx + size * 0.2, cy + size * 0.46);
  ctx.lineTo(cx + size * 0.02, cy + size * 0.36);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.02, size * 0.13, size * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** A swirled candy on a stick. */
export function drawLollipop(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  colorA: string,
  colorB: string
): void {
  const r = size * 0.32;
  const candyCy = cy - size * 0.14;

  ctx.save();

  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = size * 0.045;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, candyCy + r * 0.6);
  ctx.lineTo(cx, cy + size * 0.44);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, candyCy, r, 0, Math.PI * 2);
  ctx.fillStyle = colorA;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, candyCy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = colorB;
  ctx.lineWidth = r * 0.3;
  ctx.beginPath();
  ctx.moveTo(cx, candyCy);
  for (let t = 0; t <= 1; t += 0.03) {
    const rad = t * r * 1.4;
    const a = t * Math.PI * 5;
    ctx.lineTo(cx + Math.cos(a) * rad, candyCy + Math.sin(a) * rad);
  }
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, candyCy, r, 0, Math.PI * 2);
  ctx.lineWidth = size * 0.02;
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.stroke();

  ctx.restore();
}

/** A simple round-eared teddy bear face. */
export function drawTeddyBear(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  furColor: string
): void {
  const headR = size * 0.32;
  const earR = size * 0.13;

  ctx.save();
  ctx.fillStyle = furColor;

  ctx.beginPath();
  ctx.arc(cx - headR * 0.82, cy - headR * 0.82, earR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + headR * 0.82, cy - headR * 0.82, earR, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, headR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + headR * 0.3, headR * 0.44, headR * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(58,38,22,0.8)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + headR * 0.2, headR * 0.12, headR * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx - headR * 0.32, cy - headR * 0.05, headR * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + headR * 0.32, cy - headR * 0.05, headR * 0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** A round party balloon with a curled string. */
export function drawBalloon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const w = size * 0.32;
  const h = size * 0.42;

  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy - h * 0.15, w, h, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx - w * 0.14, cy + h * 0.78);
  ctx.lineTo(cx + w * 0.14, cy + h * 0.78);
  ctx.lineTo(cx, cy + h * 0.95);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = size * 0.015;
  ctx.beginPath();
  ctx.moveTo(cx, cy + h * 0.95);
  ctx.quadraticCurveTo(cx + w * 0.5, cy + h * 1.25, cx, cy + h * 1.6);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.32, cy - h * 0.5, w * 0.2, h * 0.26, -0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** A five-point star. */
export function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const spikes = 5;
  const outerR = size * 0.34;
  const innerR = outerR * 0.42;

  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A curved heart. */
export function drawHeart(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const s = size * 0.3;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.7);
  ctx.bezierCurveTo(cx - s * 1.3, cy - s * 0.5, cx - s * 0.4, cy - s * 1.3, cx, cy - s * 0.4);
  ctx.bezierCurveTo(cx + s * 0.4, cy - s * 1.3, cx + s * 1.3, cy - s * 0.5, cx, cy + s * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Draws an image "cover"-fit into a target rect: crops the source to the
 * target's aspect ratio (centered) before scaling, so a photo never stretches
 * regardless of the aspect ratio it was captured at (portrait or landscape).
 */
export function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): void {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;

  const targetRatio = dw / dh;
  const srcRatio = iw / ih;

  let sx = 0;
  let sy = 0;
  let sw = iw;
  let sh = ih;
  if (srcRatio > targetRatio) {
    sw = ih * targetRatio;
    sx = (iw - sw) / 2;
  } else {
    sh = iw / targetRatio;
    sy = (ih - sh) / 2;
  }

  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

/**
 * A scalloped "cloud" band: a flat color field with a row of overlapping
 * puffs along one edge. `direction: 1` hangs puffs off the bottom (for a
 * header sitting at the top of the card); `-1` lifts puffs off the top (for
 * a footer sitting at the bottom).
 */
export function drawCloudBand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  bandH: number,
  puffR: number,
  color: string,
  direction: 1 | -1
): void {
  const count = Math.max(2, Math.round(w / (puffR * 1.4)));
  const step = w / count;
  const flatH = bandH - puffR * 0.7;

  ctx.save();
  ctx.fillStyle = color;

  ctx.beginPath();
  if (direction === 1) {
    ctx.rect(x, y, w, flatH);
  } else {
    ctx.rect(x, y + bandH - flatH, w, flatH);
  }
  ctx.fill();

  const puffY = direction === 1 ? y + flatH : y + bandH - flatH;
  for (let i = 0; i <= count; i++) {
    const px = x + i * step;
    ctx.beginPath();
    ctx.arc(px, puffY, puffR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Sticker-style outlined text: a thick stroke behind a solid fill, so the
 * letterforms read as a bubble decal rather than flat type.
 */
export function drawBubbleText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  fontPx: number,
  fillColor: string,
  outlineColor: string,
  outlineWidth: number,
  weight = 800
): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `${weight} ${fontPx}px "Fraunces", Georgia, serif`;
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = outlineWidth;
  ctx.strokeStyle = outlineColor;
  ctx.strokeText(text, cx, y);
  ctx.fillStyle = fillColor;
  ctx.fillText(text, cx, y);
  ctx.restore();
}

/** The circular "?" badge tucked into the footer, like a keepsake stamp. */
export function drawQuestionBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fillColor: string,
  ringColor: string,
  textColor: string
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.lineWidth = r * 0.14;
  ctx.strokeStyle = ringColor;
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${Math.round(r * 1.25)}px "Fraunces", Georgia, serif`;
  ctx.fillText("?", cx, cy + r * 0.06);
  ctx.restore();
}

/** Converts a canvas to a Blob, resolving null rather than throwing. */
export function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.95): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
    } catch {
      resolve(null);
    }
  });
}
