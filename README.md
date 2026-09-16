# Reveal Booth

A gender-reveal photo booth for a phone. Pick a side, shoot three frames, print a strip.

```bash
npm install
npm run dev     # http://localhost:3000
```

Needs HTTPS (or `localhost`) for camera access. On a phone, serve over HTTPS —
`getUserMedia` is blocked on plain HTTP origins.

## What changed in this pass

### The final strip

The printed strip carries no per-photo furniture any more. Removed:

- the `1/3`, `2/3`, `3/3` badges stamped into the bottom-left of every frame
- the `✦` / `❀` corner medallions
- the `Shot n` labels
- the per-frame coloured rings, which alternated accent colours frame to frame

The strip now has one accent — a lamp-coloured band at the head — the team name
set alone below it, and the date plus the booth name at the foot, which is where
a real booth prints its mark. Frames are separated by paper gutters and carry a
warm soft-light tone and film grain so the photos sit in the page rather than on
top of it.

There is no remove or delete control anywhere in the app.

### Capture modes

The shutter now has two modes:

- **Now** — fires on tap, one frame per tap.
- **Timer** — counts down, then shoots, then keeps going until the roll is
  finished, the way a real booth does. Audio ticks mark each second.

The countdown length is adjustable from 1 to 15 seconds with the `−` / `+`
stepper next to the mode switch; it defaults to 3. While a sequence runs the
shutter becomes a stop button that cancels the whole chain.

Tapping any film frame re-arms it, so a frame can be shot again at any point.

### Design

Rebuilt around the object it is imitating: a velvet booth interior, engraved
brass signage, marquee bulbs in the team colour, a lacquered shutter, and a
strip printed on warm grained paper. Fraunces for display, Archivo for
interface. Palette lives in `app/globals.css` as custom properties; team colours
live in `lib/types.ts`.

## Bugs fixed

**Ghosting on the strip.** `StripResult` ran an `async` draw inside a
`useEffect` with no cancellation. With `reactStrictMode` on, the effect fires
twice, and because the draw awaits image decoding the two passes interleaved on
one canvas — the background was painted twice and photos and drop-shadows
stacked. Each draw now claims a monotonic ticket and bails after every `await`
if a newer draw has taken over.

**Doubled safe-area padding.** `#app-root` applied `env(safe-area-inset-*)` and
then every screen applied it again in its own inline styles, so notched phones
were inset twice. `#app-root` is now the single owner of the insets.

**Captures written to `photos[-1]`.** `photos.findIndex(p => !p) ?? 0` never
fell back, because `findIndex` returns `-1` rather than `undefined`. With a full
roll the active index was `-1`, and captures wrote to a `"-1"` property instead
of the array. The index is now clamped at both the initial state and the write.

**No way to retake.** Once the roll was full the shutter was swapped out for
"Continue", so a frame could never be shot again. The shutter is now permanent
and "Print strip" is a separate control that enables when the roll is complete.

**Strip could hang forever.** `loadImage` rejected on a bad photo with no
`catch`, leaving the screen on "Building your strip…". It now resolves `null`
and the screen reports a failed frame. `page.tsx` also refuses to enter the
result stage with an incomplete roll.

**Preview didn't match the capture.** The live view was free-form `object-fit:
cover` while capture cropped to a fixed 3:4, so framing lied. The preview is now
locked to the capture ratio.

**Camera error handling.** `video.play()` rejections were reported as "Camera
unavailable"; they are now ignored, since the stream is attached and
`playsInline` resumes on the next interaction. `OverconstrainedError` falls back
to any available lens, so machines with no rear camera still work.
`NotFoundError` is reported separately from a generic failure.

**Leaked timers and streams.** The flash `setTimeout` was never cleared on
unmount. Every timer is now tracked and cleared, the countdown chain is
cancelled, the `AudioContext` is closed, and the media stream is stopped when
the booth unmounts. Strict Mode's double mount no longer opens two streams.

**Accessibility.** `maximumScale: 1` / `userScalable: false` removed, so the
page can be pinch-zoomed. Controls have labels, focus is visible, and
`prefers-reduced-motion` is respected.

## Notes

- `optimizeFonts: false` in `next.config.js` — Next otherwise inlines the Google
  Fonts stylesheet at build time, which breaks builds on machines without
  network access. The stylesheet loads at runtime instead, with a system-font
  fallback. Canvas waits on `document.fonts.load()` before printing so the strip
  never prints in a fallback face.
- `npm run build` may warn `Found lockfile missing swc dependencies`. That comes
  from the existing `package-lock.json` and does not affect the build. Running
  `npm install` once regenerates the missing platform entries.
- Photos never leave the device. Everything is canvas and `getUserMedia`; there
  is no upload path.

## Layout

```
app/
  globals.css     design tokens, curtain texture, safe-area owner
  layout.tsx      fonts, metadata, viewport
  page.tsx        stage router
components/
  LoadingScreen   booth warming up
  TeamSelect      two lamp-lit panels
  Camera          live view, capture modes, countdown
  StripResult     canvas print, save/share
lib/
  types.ts        stages, teams, palette, timer bounds
  canvas.ts       fonts, grain, rounded paths, safe image loading
```
