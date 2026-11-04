// Pointer / wheel / trackpad gestures for frequency-axis instruments.
//
//   trackpad pinch      -> zoom around the pointer (wheel+ctrlKey in Chromium/Firefox,
//                          gesture* events in Safari)
//   two-finger swipe →← -> pan;  vertical swipe is left to the page
//                          (or h.wheel takes it: wheel-to-tune)
//   ctrl/⌘ + wheel      -> zoom (mouse)
//   shift + wheel       -> pan (mouse)
//   drag                -> pan, unless h.grab takes it (drag-to-tune)
//   click / tap         -> tune (or h.grab's press)
//   double click / tap  -> reset
//   two-finger touch    -> pinch zoom + pan

const TAP_SLOP = 6;      // px of movement before a press becomes a drag
const DOUBLE_MS = 300;

/**
 * @param {HTMLElement} el
 * @param {object} h handlers
 * @param {(factor:number, clientX:number) => void} h.zoom   factor > 1 zooms in
 * @param {(dxPx:number) => void} h.pan                      positive = toward higher frequency
 * @param {(clientX:number, clientY:number) => ({press?:()=>void, move:(clientX:number)=>void, end?:()=>void}|null)} [h.grab]
 *        called on a one-finger press; return a handler to take the drag over instead of panning.
 *        `press` runs at once for mouse and pen, and for touch on a tap or when the drag starts
 *        (so a vertical swipe can still scroll the page); a grab with `press` replaces h.tap.
 * @param {(e:WheelEvent) => boolean} [h.wheel]  a plain vertical scroll; return true to take it from the page
 * @param {(e:PointerEvent) => void} [h.tap]
 * @param {(e:PointerEvent) => void} [h.doubleTap]
 * @param {(clientX:number, clientY:number) => void} [h.hover]
 * @param {() => void} [h.leave]
 * @returns {() => void} detach
 */
export function attachScopeGestures(el, h) {
  const pointers = new Map();
  let downX = 0, downY = 0, moved = false, pinch = null, lastTap = { t: 0, x: 0, y: 0 };
  let safariScale = 1;
  let grab = null, pressed = false;
  const endGrab = () => { if (grab) { grab.end?.(); grab = null; el.classList.remove('is-grabbing'); } };
  const doPress = () => { if (grab?.press && !pressed) { pressed = true; grab.press(); } };

  const onWheel = (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const k = e.deltaMode === 1 ? 0.05 : 0.01;
      const f = Math.exp(-e.deltaY * k);
      h.zoom(Math.min(1.5, Math.max(0.67, f)), e.clientX);
      return;
    }
    const lineK = e.deltaMode === 1 ? 16 : 1;
    if (e.shiftKey) {
      e.preventDefault();
      h.pan((e.deltaX || e.deltaY) * lineK);
      return;
    }
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      h.pan(e.deltaX * lineK);
      return;
    }
    if (h.wheel?.(e)) e.preventDefault();
    // otherwise vertical scroll falls through to the page
  };

  const onGestureStart = (e) => { e.preventDefault(); safariScale = 1; };
  const onGestureChange = (e) => {
    e.preventDefault();
    h.zoom(e.scale / safariScale, e.clientX);
    safariScale = e.scale;
  };
  const onGestureEnd = (e) => e.preventDefault();

  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { el.setPointerCapture?.(e.pointerId); } catch { /* synthetic or already released pointer */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      downX = e.clientX; downY = e.clientY; moved = false; pressed = false;
      grab = h.grab?.(e.clientX, e.clientY) || null;
      if (grab?.press && e.pointerType !== 'touch') { doPress(); el.classList.add('is-grabbing'); }
    } else { moved = true; endGrab(); }
    pinch = null;
  };

  const onMove = (e) => {
    h.hover?.(e.clientX, e.clientY);
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > TAP_SLOP) {
        moved = true;
        doPress();
        el.classList.add(grab ? 'is-grabbing' : 'is-dragging');
      }
      if (moved) { if (grab) grab.move(e.clientX); else h.pan(-(e.clientX - prev.x)); }
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.max(8, Math.abs(a.x - b.x));
      const mid = (a.x + b.x) / 2;
      if (pinch) {
        h.zoom(dist / pinch.dist, mid);
        h.pan(-(mid - pinch.mid));
      }
      pinch = { dist, mid };
    }
  };

  const onUp = (e, cancelled) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    pinch = null;
    if (pointers.size) return;
    const g = grab;
    if (!cancelled && !moved && g) doPress(); // touch tap
    endGrab();
    el.classList.remove('is-dragging');
    if (cancelled || moved) return;
    const now = performance.now();
    if (now - lastTap.t < DOUBLE_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) {
      lastTap.t = 0;
      h.doubleTap?.(e);
      return;
    }
    lastTap = { t: now, x: e.clientX, y: e.clientY };
    if (!g?.press) h.tap?.(e);
  };
  const onPointerUp = (e) => onUp(e, false);
  const onPointerCancel = (e) => onUp(e, true);
  const onLeave = (e) => { if (e.pointerType === 'mouse' && !pointers.size) h.leave?.(); };

  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('gesturestart', onGestureStart);
  el.addEventListener('gesturechange', onGestureChange);
  el.addEventListener('gestureend', onGestureEnd);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerCancel);
  el.addEventListener('pointerleave', onLeave);

  return () => {
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('gesturestart', onGestureStart);
    el.removeEventListener('gesturechange', onGestureChange);
    el.removeEventListener('gestureend', onGestureEnd);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerCancel);
    el.removeEventListener('pointerleave', onLeave);
  };
}

// Value controls (knobs, frequency digits) should follow the fingers: push up
// to increase. With macOS "natural scrolling" (on by default) a push up arrives
// as a downward deltaY, so it has to be flipped. Safari reports the setting per
// event (webkitDirectionInvertedFromDevice); elsewhere assume the macOS default.
let scrollDirection = 'auto'; // 'auto' | 'natural' | 'traditional'
const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');

/**
 * Tell HamUI how the system scrolls when the browser cannot report it:
 * 'natural' (content follows the fingers, the macOS default), 'traditional',
 * or 'auto' (Safari's per-event flag, else natural on macOS, traditional elsewhere).
 */
export function setScrollDirection(mode) {
  scrollDirection = mode === 'natural' || mode === 'traditional' ? mode : 'auto';
}

function isNatural(e) {
  if (scrollDirection !== 'auto') return scrollDirection === 'natural';
  if (typeof e.webkitDirectionInvertedFromDevice === 'boolean') return e.webkitDirectionInvertedFromDevice;
  return IS_MAC;
}

/**
 * Accumulates wheel deltas into discrete steps so trackpads (many small
 * deltas) and mice (few large ones) tune at a similar rate. Positive steps
 * mean the fingers (or wheel) moved up: increase.
 */
export function wheelStepper(pxPerStep = 40) {
  let acc = 0;
  return (e) => {
    let d = e.deltaMode === 1 ? e.deltaY * pxPerStep : e.deltaY;
    if (isNatural(e)) d = -d;
    acc += d;
    let steps = 0;
    while (Math.abs(acc) >= pxPerStep) {
      steps += acc < 0 ? 1 : -1;
      acc += acc < 0 ? pxPerStep : -pxPerStep;
    }
    return steps;
  };
}
