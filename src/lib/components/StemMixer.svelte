<script lang="ts">
  import { stemStore, type StemState } from '../stores/stemStore';
  import { playerStore } from '../stores/playerStore';
  import { settingsStore } from '../stores/settingsStore';
  import type { StemType, PlayerState, AppSettings } from '../types';
  import { StemSeparationClient } from '../audio/StemSeparationClient';
  import { STEM_TYPES_6, STEM_LABELS, STEM_MODEL_OPTIONS, DEFAULT_SETTINGS } from '../types';
  import { DEFAULT_STEM_VOLUMES } from '../types';

  let stemState: StemState = $state({
    status: 'none',
    volumes: { ...DEFAULT_STEM_VOLUMES },
    downloadProgress: null,
    message: '',
    remainingSeconds: null,
    loadedStems: null,
    backend: null,
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

  let settings: AppSettings = $state({ ...DEFAULT_SETTINGS });

  stemStore.subscribe((v) => (stemState = v));
  playerStore.subscribe((v) => (ps = v));
  settingsStore.subscribe((v) => (settings = v));

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
    const cached = await StemSeparationClient.getInstance().isModelCached();
    if (!cached) {
      const modelOpt = STEM_MODEL_OPTIONS.find((m) => m.id === settings.stemModel) ?? STEM_MODEL_OPTIONS[0];
      const ok = confirm(
        `※モバイルでは安定して動作しない可能性があります。 \n※モデルデータ（約${modelOpt.sizeMB}MB）のダウンロードが必要です。\nWiFi環境での使用を推奨します。\n続行しますか？`,
      );
      if (!ok) return;
    }
    void stemStore.separate(trackId);
  }

  function handleVolumeChange(stem: StemType, value: number) {
    void stemStore.setStemVolume(stem, value, trackId);
  }

  function handleReset() {
    void stemStore.resetVolumes(trackId);
  }

  /** Format remaining seconds into a human-readable Japanese label */
  function formatRemaining(sec: number): string {
    if (sec <= 0) return 'もうすぐ完了';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `残り約${s}秒`;
    if (s === 0) return `残り約${m}分`;
    return `残り約${m}分${s}秒`;
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
    // String instrument — custom guitar silhouette
    // headstock bar, neck, figure-8 body (upper+lower bout), sound hole
    bass:
      'M9 3h6' +
      'M12 3v10' +
      'M12 13c-2.5.8-4.5 2.8-4.5 5.5 0 2 1.8 3.5 4.5 3.5s4.5-1.5 4.5-3.5' +
      'c0-2.7-2-4.7-4.5-5.5Z' +
      'M12 13c-2 .6-3.5 2-3.5 4 0 1 .7 2 2 2.5' +
      'M12 18.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5',
    // Musical note — two-note icon (Heroicons musical-notes variant)
    other:
      'M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904' +
      'a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347' +
      'm-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493' +
      'a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814' +
      'm-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 3.741-3.342' +
      'M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675' +
      'A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5',
    // String instrument (same shape as bass)
    guitar:
      'M9 3h6' +
      'M12 3v10' +
      'M12 13c-2.5.8-4.5 2.8-4.5 5.5 0 2 1.8 3.5 4.5 3.5s4.5-1.5 4.5-3.5' +
      'c0-2.7-2-4.7-4.5-5.5Z' +
      'M12 13c-2 .6-3.5 2-3.5 4 0 1 .7 2 2 2.5' +
      'M12 18.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5',
    // Piano keyboard — custom: 3 white keys + 2 black keys
    piano: 'M3 3h18v18H3ZM9 3v18M15 3v18M7.5 3v12h3V3M13.5 3v12h3V3',
  };
</script>

<div class="bg-surface-light p-3 space-y-3">
  {#if stemState.status === 'none' || stemState.status === 'error'}
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
          {#if stemState.remainingSeconds !== null}
            · {formatRemaining(stemState.remainingSeconds)}
          {:else}
            （数分かかる場合があります）
          {/if}
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
    <div class="flex items-center justify-between pt-1">
      {#if stemState.backend}
        <span
          class="text-[10px] font-medium px-1.5 py-0.5 rounded
            {stemState.backend === 'webgpu'
              ? 'bg-emerald-900/40 text-emerald-400'
              : 'bg-surface-lighter text-text-muted'}"
          title="ONNX Runtime Web 実行バックエンド"
        >
          {stemState.backend === 'webgpu' ? '⚡ GPU' : '⊞ CPU'}
        </span>
      {:else}
        <span></span>
      {/if}
      <button
        class="text-xs text-text-muted hover:text-text transition-colors px-2 py-1 rounded"
        onclick={handleReset}
      >
        リセット
      </button>
    </div>
  {/if}
</div>
