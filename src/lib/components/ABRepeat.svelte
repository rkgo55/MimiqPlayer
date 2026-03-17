<script lang="ts">
  import { playerStore } from '../stores/playerStore';
  import { settingsStore } from '../stores/settingsStore';
  import type { PlayerState, AppSettings } from '../types';

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
  let settings: AppSettings = $state({ skipDuration: 5, loopOffset: 0, defaultSpeed: 1, defaultPitch: 0, keepAwake: false, apiEndpoint: '', apiKey: '' });

  playerStore.subscribe((v) => (ps = v));
  settingsStore.subscribe((v) => (settings = v));

  const loopOffsetOptions = [0, 1, 2, 3, 5];

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

    <!-- ON/OFF toggle (center, repeat icon) -->
    <button
      class="p-2 rounded-lg transition-colors flex-shrink-0
        {abRepeat.enabled ? 'bg-primary/20 text-primary' : 'bg-surface-lighter text-text-muted/50 hover:text-text-muted'}"
      onclick={() => playerStore.toggleABRepeat()}
      disabled={abRepeat.a === null || abRepeat.b === null}
      title="ABリピート {abRepeat.enabled ? 'OFF' : 'ON'}"
    >
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 0 0-3.7-3.7 48.678 48.678 0 0 0-7.324 0 4.006 4.006 0 0 0-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 0 0 3.7 3.7 48.656 48.656 0 0 0 7.324 0 4.006 4.006 0 0 0 3.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3-3 3" />
      </svg>
    </button>

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

  <!-- Loop offset -->
  <div class="flex items-center gap-1.5 mt-2">
    <div class="flex gap-1">
      {#each loopOffsetOptions as opt}
        <button
          class="px-1.5 py-0.5 text-xs rounded transition-colors
            {settings.loopOffset === opt ? 'bg-primary/25 text-primary' : 'bg-surface-lighter text-text-muted hover:bg-surface-lighter/80'}"
          onclick={() => settingsStore.setLoopOffset(opt)}
        >{opt}s</button>
      {/each}
    </div>
    <span class="text-xs text-text-muted">前から再生</span>
  </div>
</div>
