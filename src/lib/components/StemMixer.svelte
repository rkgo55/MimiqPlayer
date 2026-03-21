<script lang="ts">
  import { stemStore, type StemState } from '../stores/stemStore';
  import { playerStore } from '../stores/playerStore';
  import type { StemType, PlayerState } from '../types';
  import { STEM_TYPES_6, STEM_LABELS } from '../types';
  import { DEFAULT_STEM_VOLUMES } from '../types';

  let stemState: StemState = $state({
    status: 'none',
    volumes: { ...DEFAULT_STEM_VOLUMES },
    downloadProgress: null,
    message: '',
    loadedStems: null,
  });
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

  stemStore.subscribe((v) => (stemState = v));
  playerStore.subscribe((v) => (ps = v));

  const trackId = $derived(ps.trackId);

  /**
   * Which stem sliders to show: based on what was ACTUALLY separated,
   * not what model is selected in settings.
   */
  const visibleStems = $derived<StemType[]>(
    (() => {
      if (stemState.loadedStems && stemState.loadedStems.length > 0) {
        // Show loaded stems in a consistent order
        const order = STEM_TYPES_6;
        return order.filter((s) => stemState.loadedStems!.includes(s));
      }
      return ['vocals', 'drums', 'bass', 'other'];
    })()
  );

  async function handleSeparate() {
    if (!trackId) return;
    void stemStore.separate(trackId);
  }

  function handleVolumeChange(stem: StemType, value: number) {
    void stemStore.setStemVolume(stem, value, trackId);
  }

  function handleReset() {
    void stemStore.resetVolumes(trackId);
  }

  // Stem icon paths (24×24 viewBox, stroke-based)
  const STEM_ICONS: Partial<Record<StemType, string>> = {
    // Microphone (Heroicons outline)
    vocals:
      'M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75' +
      'm-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z',
    // Drum — cylinder stack (Heroicons circle-stack)
    drums:
      'M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375' +
      'm16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375' +
      'm16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375' +
      'm16.5 5.625v2.25m-16.5-2.25v2.25',
    // Bass guitar headstock (P-bass style, 4 tuners: 3 left, 1 right)
    bass:
      'M12 3c-4.5 0-8 2.5-8 8 0 4 2 7 5 8h6c3-1 5-4 5-8 0-5.5-3.5-8-8-8Z' +
      'M10 19v4M14 19v4' +
      'M4 8.5H1M4 13H1M4 17.5H1' +
      'M20 13h3' +
      'M1 8.5a1.5 1.5 0 1 0 0 .001' +
      'M1 13a1.5 1.5 0 1 0 0 .001' +
      'M1 17.5a1.5 1.5 0 1 0 0 .001' +
      'M23 13a1.5 1.5 0 1 0 0 .001' +
      'M10.5 8a1 1 0 1 0 2 0 1 1 0 0 0-2 0' +
      'M10.5 13a1 1 0 1 0 2 0 1 1 0 0 0-2 0' +
      'M10.5 17.5a1 1 0 1 0 2 0 1 1 0 0 0-2 0' +
      'M13 10.5a1 1 0 1 0 2 0 1 1 0 0 0-2 0',
    // Musical note (quarter note)
    other:
      'M16 4v13' +
      'M12.5 17a2.5 2 20 1 0 5 0 2.5 2 20 1 0-5 0',
    // Guitar headstock (Fender Stratocaster style, 6 inline tuners on left)
    guitar:
      'M10 21V4.5c0-1 .5-1.5 2-1.5h1c4.5 0 8 2 8 6v8c0 3.5-3.5 4-8 4h-3Z' +
      'M10 21v2M14 21v2' +
      'M10 6H6M10 8.5H6M10 11H6M10 13.5H6M10 16H6M10 18.5H6' +
      'M6 6a1.5 1.5 0 1 0 0 .001' +
      'M6 8.5a1.5 1.5 0 1 0 0 .001' +
      'M6 11a1.5 1.5 0 1 0 0 .001' +
      'M6 13.5a1.5 1.5 0 1 0 0 .001' +
      'M6 16a1.5 1.5 0 1 0 0 .001' +
      'M6 18.5a1.5 1.5 0 1 0 0 .001',
    // Piano keyboard — custom: 3 white keys + 2 black keys
    piano: 'M3 3h18v18H3ZM9 3v18M15 3v18M7.5 3v12h3V3M13.5 3v12h3V3',
  };
</script>

<div class="bg-surface-light p-3 space-y-3">
  {#if stemState.status === 'loading'}
    <!-- Loading stems from storage: show nothing -->
  {:else if stemState.status === 'none' || stemState.status === 'error'}
    <!-- Separate button -->
    <div class="space-y-1.5">
      <div class="flex items-start justify-between gap-2">
        <p class="text-xs text-text-muted">
          音源を6つの楽器ごとに分離します。
        </p>
        <button
          class="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          onclick={handleSeparate}
          disabled={!trackId}
        >
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
          </svg>
          ステム分離を開始
        </button>
      </div>
      {#if stemState.status === 'error'}
        <p class="text-xs text-red-400">エラー: {stemState.message}</p>
      {/if}
    </div>
  {:else if stemState.status === 'processing'}
    <!-- Progress -->
    <div class="space-y-1.5">
      <div class="flex items-start justify-between gap-2">
        <p class="text-xs text-text-muted">
          {stemState.message}
          （数分かかる場合があります）
        </p>
        <button
          class="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-accent/15 text-accent transition-colors opacity-75 cursor-default"
          disabled
        >
          <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          分離中…
        </button>
      </div>
      {#if stemState.downloadProgress !== null}
        <div class="w-full bg-surface-lighter rounded-full h-1.5">
          <div
            class="bg-primary h-1.5 rounded-full transition-all duration-300"
            style="width: {stemState.downloadProgress}%"
          ></div>
        </div>
      {/if}
      <p class="text-[11px] text-text-muted opacity-70">
        処理中はアプリを閉じないでください
      </p>
    </div>
  {:else if stemState.status === 'ready'}
    <!-- Stem volume sliders -->
    <div class="space-y-2">
      {#each visibleStems as stem}
        {@const vol = stemState.volumes[stem] ?? 1}
        <div class="flex items-center gap-3">
          <!-- Icon button (click to mute/unmute) -->
          <button
            class="w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center transition-colors
              {vol === 0
                ? 'bg-surface-lighter text-text-muted opacity-50'
                : 'bg-surface-lighter text-text'}"
            title="{vol === 0 ? '有効化' : 'ミュート'}: {STEM_LABELS[stem]}"
            onclick={() => handleVolumeChange(stem, vol === 0 ? 1 : 0)}
            aria-label="{STEM_LABELS[stem]}"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d={STEM_ICONS[stem]} />
            </svg>
          </button>

          <!-- Slider -->
          <div class="flex-1 relative h-8 flex items-center">
            <!-- Track background -->
            <div class="absolute inset-x-0 h-1 rounded-full bg-surface-lighter"></div>
            <!-- Filled track -->
            <div
              class="absolute left-0 h-1 rounded-full transition-all duration-75
                {vol === 0 ? 'bg-surface-lighter' : 'bg-primary'}"
              style="width: {vol * 100}%"
            ></div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={vol}
              class="relative w-full h-1 appearance-none bg-transparent cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:w-4
                [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:bg-white
                [&::-webkit-slider-thumb]:shadow-md
                [&::-webkit-slider-thumb]:border
                [&::-webkit-slider-thumb]:border-primary/30"
              oninput={(e) => handleVolumeChange(stem, Number((e.target as HTMLInputElement).value))}
            />
          </div>

          <!-- Value label -->
          <span class="w-9 text-right text-xs tabular-nums text-text-muted">
            {Math.round(vol * 100)}%
          </span>
        </div>
      {/each}
    </div>

    <!-- Reset button -->
    <div class="flex items-center justify-end pt-1">
      <button
        class="text-xs text-text-muted hover:text-text transition-colors px-2 py-1 rounded"
        onclick={handleReset}
      >
        リセット
      </button>
    </div>
  {/if}
</div>
