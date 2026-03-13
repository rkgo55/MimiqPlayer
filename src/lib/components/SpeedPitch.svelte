<script lang="ts">
  import { playerStore } from '../stores/playerStore';
  import type { PlayerState } from '../types';

  let ps: PlayerState = $state({
    trackId: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    speed: 1,
    pitch: 0,
    volume: 1,
    abRepeat: { enabled: false, a: null, b: null },
  });

  playerStore.subscribe((v) => (ps = v));

  const speedPresets = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
</script>

<div class="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
  <!-- Speed Control -->
  <div class="bg-surface-light rounded-lg p-3">
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs text-text-muted">速度</span>
      <span class="text-sm font-mono font-medium">{ps.speed.toFixed(2)}x</span>
    </div>
    <div class="flex flex-wrap gap-1.5">
      {#each speedPresets as preset}
        <button
          class="flex-1 py-1.5 text-xs rounded transition-colors
            {Math.abs(ps.speed - preset) < 0.01 ? 'bg-primary text-white' : 'bg-surface-lighter hover:bg-surface-lighter/80 active:bg-surface-lighter/80 text-text-muted'}"
          onclick={() => playerStore.setSpeed(preset)}
        >
          {preset}x
        </button>
      {/each}
    </div>
  </div>

  <!-- Pitch Control -->
  <div class="bg-surface-light rounded-lg p-3">
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs text-text-muted">ピッチ</span>
      <span class="text-sm font-mono font-medium">
        {ps.pitch > 0 ? '+' : ''}{ps.pitch} 半音
      </span>
    </div>
    <div class="flex items-center gap-1.5">
      <button
        class="flex-1 py-1.5 text-xs rounded bg-surface-lighter hover:bg-surface-lighter/80 active:bg-surface-lighter/80 text-text-muted transition-colors"
        onclick={() => playerStore.setPitch(ps.pitch - 2)}
        disabled={ps.pitch <= -12}
      >
        −2
      </button>
      <button
        class="flex-1 py-1.5 text-xs rounded bg-surface-lighter hover:bg-surface-lighter/80 active:bg-surface-lighter/80 text-text-muted transition-colors"
        onclick={() => playerStore.setPitch(ps.pitch - 1)}
        disabled={ps.pitch <= -12}
      >
        −1
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded transition-colors
          {ps.pitch === 0 ? 'bg-primary text-white' : 'bg-surface-lighter hover:bg-surface-lighter/80 active:bg-surface-lighter/80 text-text-muted'}"
        onclick={() => playerStore.setPitch(0)}
      >
        ±0
      </button>
      <button
        class="flex-1 py-1.5 text-xs rounded bg-surface-lighter hover:bg-surface-lighter/80 active:bg-surface-lighter/80 text-text-muted transition-colors"
        onclick={() => playerStore.setPitch(ps.pitch + 1)}
        disabled={ps.pitch >= 12}
      >
        +1
      </button>
      <button
        class="flex-1 py-1.5 text-xs rounded bg-surface-lighter hover:bg-surface-lighter/80 active:bg-surface-lighter/80 text-text-muted transition-colors"
        onclick={() => playerStore.setPitch(ps.pitch + 2)}
        disabled={ps.pitch >= 12}
      >
        +2
      </button>
    </div>
  </div>
</div>