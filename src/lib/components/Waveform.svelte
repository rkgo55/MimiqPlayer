<script lang="ts">
  import { playerStore, trimStart as trimStartStore, trimEnd as trimEndStore, activeBookmarkId as activeBookmarkIdStore } from '../stores/playerStore';
  import type { WaveformData, PlayerState, LoopBookmark } from '../types';

  interface Props {
    showTrimmer?: boolean;
  }
  let { showTrimmer = false }: Props = $props();

  let waveformData: WaveformData | null = $state(null);
  let playerState: PlayerState = $state({
    trackId: null, isPlaying: false, currentTime: 0, duration: 0,
    speed: 1, pitch: 0, volume: 1,
    abRepeat: { enabled: false, a: null, b: null },
  });
  let _trimStart = $state(0);
  let _trimEnd = $state<number | null>(null);
  let _bookmarks = $state<LoopBookmark[]>([]);
  let _activeBookmarkId = $state<string | null>(null);

  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;

  // Local zoom state — purely for display navigation, not persisted
  let zoomLevel = $state(1);
  let zoomOffset = $state(0); // 0..1 fraction of total duration at left edge

  // Pointer interaction
  type DragTarget = 'seek' | 'pan' | 'playhead' | 'trimStart' | 'trimEnd' | 'abA' | 'abB' | null;
  let dragTarget = $state<DragTarget>(null);
  let activePointerId: number | null = $state(null);
  let hoverTarget = $state<HandleTarget | null>(null);

  // Pan state
  let panStartX = 0;
  let panStartOffset = 0;
  let hasPanned = false;

  // Pinch-to-zoom state (touch with two fingers)
  const pinchPointers = new Map<number, number>(); // pointerId → clientX
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let pinchStartOffset = 0;

  $effect(() => { const u = playerStore.waveform.subscribe((v) => { waveformData = v; requestAnimationFrame(draw); }); return u; });
  $effect(() => { const u = playerStore.subscribe((v) => { playerState = v; requestAnimationFrame(draw); }); return u; });
  $effect(() => { const u = trimStartStore.subscribe((v) => { _trimStart = v; requestAnimationFrame(draw); }); return u; });
  $effect(() => { const u = trimEndStore.subscribe((v) => { _trimEnd = v; requestAnimationFrame(draw); }); return u; });
  $effect(() => { const u = playerStore.bookmarks.subscribe((v) => { _bookmarks = v; }); return u; });
  $effect(() => { const u = activeBookmarkIdStore.subscribe((v) => { _activeBookmarkId = v; }); return u; });

  // Reset zoom when track changes
  let _lastTrackId: string | null = null;
  $effect(() => {
    const tid = playerState.trackId;
    if (tid !== _lastTrackId) { _lastTrackId = tid; zoomLevel = 1; zoomOffset = 0; }
  });

  $effect(() => { showTrimmer; zoomLevel; zoomOffset; requestAnimationFrame(draw); });

  function visibleRange(): { start: number; end: number } {
    const range = 1 / zoomLevel;
    const start = Math.min(Math.max(0, zoomOffset), 1 - range);
    return { start, end: start + range };
  }

  function timeToX(t: number, w: number): number {
    const dur = waveformData?.duration ?? 0;
    if (dur <= 0) return 0;
    const { start, end } = visibleRange();
    return ((t / dur - start) / (end - start)) * w;
  }

  function xToTime(x: number, w: number): number {
    const dur = waveformData?.duration ?? 0;
    const { start, end } = visibleRange();
    const frac = start + (x / w) * (end - start);
    return Math.max(0, Math.min(dur, frac * dur));
  }

  function draw() {
    if (!canvas || !waveformData) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const { peaks, duration } = waveformData;
    ctx.clearRect(0, 0, w, h);

    const { start: visStart, end: visEnd } = visibleRange();
    const startIdx = Math.floor(visStart * peaks.length);
    const endIdx = Math.min(peaks.length, Math.ceil(visEnd * peaks.length));
    const visiblePeaks = peaks.slice(startIdx, endIdx);
    const count = visiblePeaks.length || 1;
    const barW = w / count;
    const progress = duration > 0 ? playerState.currentTime / duration : 0;

    // ── Trim region overlay ───────────────────────────────────────────────
    if (showTrimmer && duration > 0) {
      const tsX = timeToX(_trimStart, w);
      const teX = timeToX(_trimEnd ?? duration, w);
      ctx.fillStyle = 'rgba(0,0,0,0.48)';
      if (tsX > 0) ctx.fillRect(0, 0, Math.max(0, tsX), h);
      if (teX < w) ctx.fillRect(Math.min(w, teX), 0, w - Math.min(w, teX), h);
      ctx.fillStyle = 'rgba(245,158,11,0.1)';
      const sx1 = Math.max(0, tsX), sx2 = Math.min(w, teX);
      if (sx2 > sx1) ctx.fillRect(sx1, 0, sx2 - sx1, h);
    }

    // ── A-B repeat region fill ────────────────────────────────────────────
    const { abRepeat } = playerState;
    if (abRepeat.a !== null && abRepeat.b !== null) {
      const ax = timeToX(abRepeat.a, w);
      const bx = timeToX(abRepeat.b, w);
      const cax = Math.max(0, ax), cbx = Math.min(w, bx);
      if (cbx > cax) {
        ctx.fillStyle = abRepeat.enabled ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)';
        ctx.fillRect(cax, 0, cbx - cax, h);
      }
    }

    // ── Waveform bars ─────────────────────────────────────────────────────
    for (let i = 0; i < count; i++) {
      const x = i * barW;
      const barH = visiblePeaks[i] * h * 0.8;
      const y = (h - barH) / 2;
      const globalFrac = (startIdx + i) / peaks.length;
      ctx.fillStyle = globalFrac < progress ? 'rgba(99, 102, 241, 0.9)' : 'rgba(54, 54, 82, 0.8)';
      ctx.fillRect(x, y, Math.max(barW - 1, 1), barH || 1);
    }

    // ── Playhead ──────────────────────────────────────────────────────────
    if (duration > 0 && progress >= visStart && progress <= visEnd) {
      const px = timeToX(playerState.currentTime, w);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    }

    // ── A-B handles ───────────────────────────────────────────────────────
    if (abRepeat.b !== null) drawABHandle(ctx, timeToX(abRepeat.b, w), h, '#ef4444', 'B', false);
    if (abRepeat.a !== null) drawABHandle(ctx, timeToX(abRepeat.a, w), h, '#22c55e', 'A', true);

    // ── Trim handles ──────────────────────────────────────────────────────
    if (showTrimmer && duration > 0) {
      drawTrimHandle(ctx, timeToX(_trimStart, w), h, false);
      drawTrimHandle(ctx, timeToX(_trimEnd ?? duration, w), h, true);
    }


  }

  /** A/B handle: triangle tab at top of canvas + vertical line */
  function drawABHandle(ctx: CanvasRenderingContext2D, x: number, h: number, color: string, label: string, isA: boolean) {
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    const TW = 9, TH = 14;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (isA) { ctx.moveTo(x, 0); ctx.lineTo(x + TW, 0); ctx.lineTo(x, TH); }
    else      { ctx.moveTo(x, 0); ctx.lineTo(x - TW, 0); ctx.lineTo(x, TH); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = isA ? 'left' : 'right';
    ctx.fillText(label, isA ? x + 2 : x - 2, 10);
    ctx.textAlign = 'left';
  }

  /** Trim handle: amber grip tab at top */
  function drawTrimHandle(ctx: CanvasRenderingContext2D, x: number, h: number, isEnd: boolean) {
    const GW = 10, GH = 18;
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    const gx = isEnd ? x - GW : x;
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    if ((ctx as CanvasRenderingContext2D & { roundRect?: (...a: unknown[]) => void }).roundRect)
      (ctx as unknown as { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(gx, 0, GW, GH, 2);
    else ctx.rect(gx, 0, GW, GH);
    ctx.fill();
    ctx.strokeStyle = '#92400e'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const ly = 4 + i * 5;
      ctx.beginPath(); ctx.moveTo(gx + 2, ly); ctx.lineTo(gx + GW - 2, ly); ctx.stroke();
    }
  }

  const TRIM_HIT_PX = 14;
  const AB_HIT_PX = 10;

  type HandleTarget = 'playhead' | 'trimStart' | 'trimEnd' | 'abA' | 'abB';
  function hitTest(x: number, w: number): HandleTarget | null {
    const dur = waveformData?.duration ?? 0;
    if (dur <= 0) return null;
    // Trim handles take priority when trimmer is open
    if (showTrimmer) {
      if (Math.abs(x - timeToX(_trimEnd ?? dur, w)) <= TRIM_HIT_PX) return 'trimEnd';
      if (Math.abs(x - timeToX(_trimStart, w)) <= TRIM_HIT_PX) return 'trimStart';
    }
    // A-B handles
    const { abRepeat } = playerState;
    if (abRepeat.b !== null && Math.abs(x - timeToX(abRepeat.b, w)) <= AB_HIT_PX) return 'abB';
    if (abRepeat.a !== null && Math.abs(x - timeToX(abRepeat.a, w)) <= AB_HIT_PX) return 'abA';
    // Playhead (only when zoomed so tap-to-seek at zoom=1 is unaffected)
    if (zoomLevel > 1 && Math.abs(x - timeToX(playerState.currentTime, w)) <= AB_HIT_PX) return 'playhead';
    return null;
  }

  function handlePointerDown(e: PointerEvent) {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;

    // Track all pointers for pinch detection
    pinchPointers.set(e.pointerId, e.clientX);
    container.setPointerCapture(e.pointerId);

    if (pinchPointers.size === 2) {
      // Second finger arrived — switch to pinch mode
      dragTarget = null;
      activePointerId = null;
      const [x1, x2] = [...pinchPointers.values()];
      pinchStartDist = Math.abs(x2 - x1);
      pinchStartZoom = zoomLevel;
      pinchStartOffset = zoomOffset;
      return;
    }

    const hit = hitTest(x, rect.width);
    if (hit) {
      dragTarget = hit;
      activePointerId = e.pointerId;
      return;
    }

    // No handle hit — always use tap-to-seek / drag-to-pan pattern
    dragTarget = 'pan';
    activePointerId = e.pointerId;
    panStartX = e.clientX;
    panStartOffset = zoomOffset;
    hasPanned = false;
  }

  function handlePointerMove(e: PointerEvent) {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;

    // Update pinch tracking
    if (pinchPointers.has(e.pointerId)) {
      pinchPointers.set(e.pointerId, e.clientX);
    }

    // Pinch zoom: two pointers active
    if (pinchPointers.size === 2) {
      const [x1, x2] = [...pinchPointers.values()];
      const dist = Math.abs(x2 - x1);
      if (pinchStartDist > 0) {
        const scale = dist / pinchStartDist;
        const newZoom = Math.max(1, Math.min(16, pinchStartZoom * scale));
        const newRange = 1 / newZoom;
        const anchorFrac = pinchStartOffset + 0.5 * (1 / pinchStartZoom);
        zoomOffset = Math.max(0, Math.min(1 - newRange, anchorFrac - 0.5 * newRange));
        zoomLevel = newZoom;
        requestAnimationFrame(draw);
      }
      return;
    }

    if (!dragTarget) {
      hoverTarget = hitTest(x, rect.width);
      return;
    }
    if (activePointerId !== null && e.pointerId !== activePointerId) return;

    if (dragTarget === 'seek') { seekFromClientX(e.clientX); return; }

    if (dragTarget === 'pan') {
      const dx = e.clientX - panStartX;
      if (Math.abs(dx) > 4) hasPanned = true;
      if (hasPanned) {
        const dur = waveformData?.duration ?? 0;
        if (dur <= 0) return;
        const rangeFrac = 1 / zoomLevel;
        const dt = -(dx / rect.width) * rangeFrac;
        zoomOffset = Math.max(0, Math.min(1 - rangeFrac, panStartOffset + dt));
        requestAnimationFrame(draw);
      }
      return;
    }

    const t = xToTime(x, rect.width);
    const dur = waveformData?.duration ?? 0;
    const MIN_GAP = 0.05;
    if (dragTarget === 'playhead') {
      playerStore.seek(t);
      return;
    }
    if (dragTarget === 'trimStart') {
      trimStartStore.set(Math.max(0, Math.min(t, (_trimEnd ?? dur) - MIN_GAP)));
    } else if (dragTarget === 'trimEnd') {
      trimEndStore.set(Math.min(dur, Math.max(t, _trimStart + MIN_GAP)));
    } else if (dragTarget === 'abA') {
      playerStore.setATime(t);
    } else if (dragTarget === 'abB') {
      playerStore.setBTime(t);
    }
  }

  function handlePointerUp(e?: PointerEvent) {
    if (e) pinchPointers.delete(e.pointerId);
    const finished = dragTarget;
    dragTarget = null;
    if (e && activePointerId !== null) container?.releasePointerCapture(activePointerId);
    if (e?.pointerId !== activePointerId) { activePointerId = null; return; }
    activePointerId = null;

    // Tap-to-seek: pan mode but pointer barely moved
    if (finished === 'pan' && !hasPanned && e) {
      seekFromClientX(e.clientX);
    }

    // Persist bookmark update when dragging an active bookmark's A/B handle
    if ((finished === 'abA' || finished === 'abB') && _activeBookmarkId) {
      const bm = _bookmarks.find((b) => b.id === _activeBookmarkId);
      if (bm) {
        const { a, b } = playerState.abRepeat;
        if (a !== null && b !== null) {
          void playerStore.updateBookmark(_activeBookmarkId, bm.label, a, b);
        }
      }
    }
  }

  function seekFromClientX(clientX: number) {
    if (!waveformData || !container) return;
    const rect = container.getBoundingClientRect();
    playerStore.seek(xToTime(clientX - rect.left, rect.width));
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    if (!waveformData || !container) return;
    const rect = container.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width;
    const { start: vs, end: ve } = visibleRange();
    const anchorFrac = vs + cx * (ve - vs);
    const zoomFactor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const newZoom = Math.max(1, Math.min(16, zoomLevel * zoomFactor));
    const newRange = 1 / newZoom;
    zoomOffset = Math.max(0, Math.min(1 - newRange, anchorFrac - cx * newRange));
    zoomLevel = newZoom;
  }

  const isHandleDrag = $derived(
    dragTarget === 'playhead' ||
    dragTarget === 'trimStart' || dragTarget === 'trimEnd' ||
    dragTarget === 'abA' || dragTarget === 'abB'
  );
  const isHandleHover = $derived(
    hoverTarget === 'playhead' ||
    hoverTarget === 'trimStart' || hoverTarget === 'trimEnd' ||
    hoverTarget === 'abA' || hoverTarget === 'abB'
  );
  const isPanMode = $derived(dragTarget === 'pan' && hasPanned);

  // Scrollbar
  let scrollbarTrack: HTMLDivElement = $state(null!);
  let scrollbarDragging = false;
  let scrollbarStartX = 0;
  let scrollbarStartOffset = 0;

  const scrollThumbLeft = $derived(zoomOffset * 100);
  const scrollThumbWidth = $derived((1 / zoomLevel) * 100);

  function handleScrollbarDown(e: PointerEvent) {
    e.stopPropagation();
    const rect = scrollbarTrack.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frac = x / rect.width;
    const rangeFrac = 1 / zoomLevel;
    zoomOffset = Math.max(0, Math.min(1 - rangeFrac, frac - rangeFrac / 2));
    scrollbarDragging = true;
    scrollbarStartX = e.clientX;
    scrollbarStartOffset = zoomOffset;
    scrollbarTrack.setPointerCapture(e.pointerId);
    requestAnimationFrame(draw);
  }

  function handleScrollbarMove(e: PointerEvent) {
    if (!scrollbarDragging) return;
    const rect = scrollbarTrack.getBoundingClientRect();
    const dx = e.clientX - scrollbarStartX;
    const rangeFrac = 1 / zoomLevel;
    zoomOffset = Math.max(0, Math.min(1 - rangeFrac, scrollbarStartOffset + dx / rect.width));
    requestAnimationFrame(draw);
  }

  function handleScrollbarUp() {
    scrollbarDragging = false;
  }
</script>

<div class="w-full">
  <div
    bind:this={container}
    class="relative w-full h-20 rounded-lg overflow-hidden bg-surface-light touch-none"
    class:cursor-pointer={!isHandleDrag && !isHandleHover && !isPanMode}
    class:cursor-ew-resize={isHandleDrag || isHandleHover}
    class:cursor-grab={!isHandleDrag && !isHandleHover && !isPanMode && zoomLevel > 1}
    class:cursor-grabbing={isPanMode}
    role="slider"
    tabindex="0"
    aria-label="再生位置"
    aria-valuemin={0}
    aria-valuemax={playerState.duration}
    aria-valuenow={playerState.currentTime}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
    onwheel={handleWheel}
  >
    <canvas id="waveform-canvas" bind:this={canvas} class="w-full h-full"></canvas>
  </div>
  {#if zoomLevel > 1}
  <div
    bind:this={scrollbarTrack}
    class="relative w-full h-2 mt-1 rounded-full bg-surface-light overflow-hidden cursor-pointer touch-none"
    onpointerdown={handleScrollbarDown}
    onpointermove={handleScrollbarMove}
    onpointerup={handleScrollbarUp}
    onpointercancel={handleScrollbarUp}
    role="scrollbar"
    aria-controls="waveform-canvas"
    aria-orientation="horizontal"
    aria-valuenow={scrollThumbLeft}
    aria-valuemin={0}
    aria-valuemax={100}
    tabindex="-1"
  >
    <div
      class="absolute h-full rounded-full bg-indigo-500/60 hover:bg-indigo-500/80 transition-colors"
      style="left: {scrollThumbLeft}%; width: {scrollThumbWidth}%"
    ></div>
  </div>
  {/if}
</div>

