// editor.js: a plain Canvas2D image editor with no image-processing library.
// It pads or crops the source image to a square, flattens any transparency
// onto white (by drawing onto a canvas pre-filled with white — a transparent
// PNG composited over that is automatically opaque-white where it was
// transparent), lets the user pan/zoom to center the product, and exports to
// a target resolution. See rules.js for the Mercado Livre numbers this
// checks against.
//
// This file has no dependency on the yzma/WASM side — it works even if the
// AI model never loads.

const Editor = (() => {
  const canvas = document.getElementById("editorCanvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  // state.scale is a user multiplier on top of the automatic contain/cover
  // fit for the current mode. offsetX/offsetY are in canvas pixel space.
  const state = {
    img: null,
    naturalWidth: 0,
    naturalHeight: 0,
    mode: "pad", // "pad" (contain, never crops) or "crop" (cover, fills the square)
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    targetSide: 1200,
  };

  let dragging = false;
  let dragStart = null;

  function baseScale() {
    if (!state.img) return 1;
    const side = canvas.width;
    const fitContain = Math.min(side / state.naturalWidth, side / state.naturalHeight);
    const fitCover = Math.max(side / state.naturalWidth, side / state.naturalHeight);
    return state.mode === "pad" ? fitContain : fitCover;
  }

  function render() {
    const side = canvas.width;

    // White fill first: this is both the "pad" background AND what flattens
    // a transparent source image (drawImage of an RGBA source over an opaque
    // white canvas leaves fully-opaque white wherever the source had alpha).
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, side, side);

    if (!state.img) return;

    const scale = baseScale() * state.scale;
    const drawWidth = state.naturalWidth * scale;
    const drawHeight = state.naturalHeight * scale;
    const x = (side - drawWidth) / 2 + state.offsetX;
    const y = (side - drawHeight) / 2 + state.offsetY;

    ctx.drawImage(state.img, x, y, drawWidth, drawHeight);
  }

  async function loadFile(file) {
    const bitmap = await createImageBitmap(file);
    state.img = bitmap;
    state.naturalWidth = bitmap.width;
    state.naturalHeight = bitmap.height;
    state.scale = 1;
    state.offsetX = 0;
    state.offsetY = 0;
    render();
  }

  function setMode(mode) {
    state.mode = mode;
    render();
  }

  function setZoom(multiplier) {
    state.scale = Math.max(0.1, multiplier);
    render();
  }

  function setTargetSide(side) {
    const clamped = Math.min(1920, Math.max(500, Math.round(side)));
    state.targetSide = clamped;
    canvas.width = clamped;
    canvas.height = clamped;
    render();
    return clamped;
  }

  function pixelRatio() {
    // The canvas can be displayed smaller than its actual pixel size (CSS
    // max-width: 100%), so pointer deltas in CSS px must be scaled up to
    // canvas px to feel 1:1 while dragging.
    return canvas.width / canvas.clientWidth;
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!state.img) return;
    dragging = true;
    dragStart = { x: event.clientX, y: event.clientY, offX: state.offsetX, offY: state.offsetY };
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const ratio = pixelRatio();
    state.offsetX = dragStart.offX + (event.clientX - dragStart.x) * ratio;
    state.offsetY = dragStart.offY + (event.clientY - dragStart.y) * ratio;
    render();
  });

  function endDrag() {
    dragging = false;
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!state.img) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.05 : 0.05;
      state.scale = Math.max(0.1, state.scale + delta);
      render();
    },
    { passive: false },
  );

  // exportBlob rasterizes the current canvas to a Blob. quality only applies
  // to image/jpeg. Returns { blob, bytes }.
  function exportBlob(type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("toBlob falhou"));
            return;
          }
          resolve(blob);
        },
        type,
        quality,
      );
    });
  }

  // pixelsForAI returns { width, height, rgba } downscaled to at most
  // AI_CHECK_MAX_SIDE on the longest side (see rules.js) — independent of the
  // export canvas above, since the vision model gains nothing from a larger
  // image and it only costs more time.
  function pixelsForAI(maxSide) {
    if (!state.img) return null;

    const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    const width = Math.max(1, Math.round(canvas.width * scale));
    const height = Math.max(1, Math.round(canvas.height * scale));

    const off = document.createElement("canvas");
    off.width = width;
    off.height = height;
    const offCtx = off.getContext("2d", { willReadFrequently: true });
    offCtx.drawImage(canvas, 0, 0, width, height);

    return { width, height, rgba: offCtx.getImageData(0, 0, width, height).data };
  }

  function hasImage() {
    return !!state.img;
  }

  function naturalSize() {
    return { width: state.naturalWidth, height: state.naturalHeight };
  }

  return { loadFile, setMode, setZoom, setTargetSide, exportBlob, pixelsForAI, hasImage, naturalSize };
})();
