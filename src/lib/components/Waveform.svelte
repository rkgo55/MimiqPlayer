<script lang="ts">
  import { playerStore } from '../stores/playerStore';
  import type { WaveformData, PlayerState } from '../types';

  let waveformData: WaveformData | null = $state(null);
  let playerState: PlayerState = $state({
    trackId: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    speed: 1,
    pitch: 0,
    volume: 1,
    abRepeat: { enabled: false, a: null, b: null },
  });

  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let isDragging = $state(false);
  let activePointerId: number | null = $state(null);

  $effect(() => {
    const unsub = playerStore.waveform.subscribe((v) => {
      waveformData = v;
      requestAnimationFrame(draw);
    });
    return unsub;
  });

  $effect(() => {
    const unsub = playerStore.subscribe((v) => {
      playerState = v;
      requestAnimationFrame(draw);
    });
    return unsub;
  });

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
    const barWidth = w / peaks.length;
    const progress = duration > 0 ? playerState.currentTime / duration : 0;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Draw A-B markers
    const { abRepeat } = playerState;
    if (abRepeat.a !== null) {
      const ax = (abRepeat.a / duration) * w;
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax, 0);
      ctx.lineTo(ax, h);
      ctx.stroke();

      // Label
      ctx.fillStyle = '#22c55e';
      ctx.font = '10px sans-serif';
      ctx.fillText('A', ax + 2, 12);
    }
    if (abRepeat.b !== null) {
      const bx = (abRepeat.b / duration) * w;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.lineTo(bx, h);
      ctx.stroke();

      ctx.fillStyle = '#ef4444';
      ctx.font = '10px sans-serif';
      ctx.fillText('B', bx + 2, 12);
    }
    if (abRepeat.a !== null && abRepeat.b !== null) {
      const ax = (abRepeat.a / duration) * w;
      const bx = (abRepeat.b / duration) * w;
      ctx.fillStyle = abRepeat.enabled
        ? 'rgba(99,102,241,0.1)'
        : 'rgba(99,102,241,0.05)';
      ctx.fillRect(ax, 0, bx - ax, h);
    }

    // Draw waveform bars
    for (let i = 0; i < peaks.length; i++) {
      const x = i * barWidth;
      const barH = peaks[i] * h * 0.8;
      const y = (h - barH) / 2;
      const barProgress = i / peaks.length;

      ctx.fillStyle =
        barProgress < progress
          ? 'rgba(99, 102, 241, 0.9)'
          : 'rgba(54, 54, 82, 0.8)';
      ctx.fillRect(x, y, Math.max(barWidth - 1, 1), barH || 1);
    }

    // Playhead
    const playheadX = progress * w;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, h);
    ctx.stroke();
  }

  function seekFromClientX(clientX: number) {
    if (!waveformData || !container) return;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const time = ratio * waveformData.duration;
    playerStore.seek(time);
  }

  function handlePointerDown(e: PointerEvent) {
    isDragging = true;
    activePointerId = e.pointerId;
    container?.setPointerCapture?.(e.pointerId);
    seekFromClientX(e.clientX);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    seekFromClientX(e.clientX);
  }

  function handlePointerUp(e?: PointerEvent) {
    isDragging = false;
    if (e && activePointerId !== null) {
      container?.releasePointerCapture?.(activePointerId);
    }
    activePointerId = null;
  }
</script>

<div
  bind:this={container}
  class="relative w-full h-20 rounded-lg overflow-hidden cursor-pointer bg-surface-light touch-none"
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
>
  <canvas bind:this={canvas} class="w-full h-full"></canvas>
</div>
