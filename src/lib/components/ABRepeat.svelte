<script lang="ts">
  import { playerStore } from '../stores/playerStore';
  import type { PlayerState } from '../types';

  let { bare = false }: { bare?: boolean } = $props();

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

  function formatTime(sec: number | null): string {
    if (sec === null || !isFinite(sec)) return '--:--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  const { abRepeat } = $derived(ps);
</script>

<div class="{bare ? '' : 'bg-surface-light rounded-lg p-3'}">
  <div class="flex items-center gap-2">
    <!-- Set A -->
    <button
      class="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm transition-colors
        {abRepeat.a !== null ? 'bg-success/20 text-success border border-success/30' : 'bg-surface-lighter text-text-muted hover:bg-surface-lighter/80'}"
      onclick={() => playerStore.setA()}
      title="現在位置をAに設定"
    >
      <span class="font-bold">A</span>
      <span class="text-xs">{formatTime(abRepeat.a)}</span>
    </button>

    <!-- Arrow -->
    <svg class="w-4 h-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>

    <!-- Set B -->
    <button
      class="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm transition-colors
        {abRepeat.b !== null ? 'bg-danger/20 text-danger border border-danger/30' : 'bg-surface-lighter text-text-muted hover:bg-surface-lighter/80'}"
      onclick={() => playerStore.setB()}
      title="現在位置をBに設定"
    >
      <span class="font-bold">B</span>
      <span class="text-xs">{formatTime(abRepeat.b)}</span>
    </button>

    <button
      class="px-2 py-0.5 text-xs rounded transition-colors
        {abRepeat.enabled ? 'bg-primary text-white' : 'bg-surface-lighter text-text-muted hover:bg-surface-lighter/80'}"
      onclick={() => playerStore.toggleABRepeat()}
      disabled={abRepeat.a === null || abRepeat.b === null}
    >
      <span class="inline-block w-6 text-center">{abRepeat.enabled ? 'ON' : 'OFF'}</span>
    </button>

    <!-- Clear -->
    <button
      class="p-2 rounded-lg hover:bg-surface-lighter transition-colors text-text-muted hover:text-text"
      onclick={() => playerStore.clearAB()}
      title="A-Bをクリア"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
      </svg>
    </button>
  </div>
</div>
