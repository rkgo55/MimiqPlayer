<script lang="ts">
  import { selectedTrack } from '../stores/trackStore';
  import { playerStore } from '../stores/playerStore';
  import { settingsStore } from '../stores/settingsStore';
  import { stemStore, type StemState } from '../stores/stemStore';
  import Waveform from './Waveform.svelte';
  import Controls from './Controls.svelte';
  import SpeedPitch from './SpeedPitch.svelte';
  import ABRepeat from './ABRepeat.svelte';
  import EQPanel from './EQPanel.svelte';
  import LoopBookmarks from './LoopBookmarks.svelte';
  import ChordDisplay from './ChordDisplay.svelte';
  import StemMixer from './StemMixer.svelte';
  import type { TrackMeta, AppSettings, PlayerState, EQBands } from '../types';
  import { EQ_FLAT } from '../types';

  let track: TrackMeta | null = $state(null);
  let settings: AppSettings = $state({ skipDuration: 5, defaultSpeed: 1, defaultPitch: 0 });
  let ps: PlayerState = $state({
    trackId: null, isPlaying: false, currentTime: 0, duration: 0,
    speed: 1, pitch: 0, volume: 1,
    abRepeat: { enabled: false, a: null, b: null },
  });
  let showPlaySettings = $state(false);
  let showEQ = $state(false);
  let showStems = $state(false);
  let eq: EQBands = $state([...EQ_FLAT]);

  selectedTrack.subscribe((v) => (track = v));
  settingsStore.subscribe((v) => (settings = v));

  // Watch trackId changes to trigger stem loading
  let prevTrackId: string | null = null;
  playerStore.subscribe((v) => {
    ps = v;
    if (v.trackId !== prevTrackId) {
      prevTrackId = v.trackId;
      if (v.trackId) void stemStore.onTrackLoaded(v.trackId);
    }
  });
  playerStore.eq.subscribe((v) => (eq = [...v] as EQBands));

  // Stem state
  let stemState: StemState = $state({
    status: 'none',
    volumes: { vocals: 1, drums: 1, bass: 1, other: 1 },
    downloadProgress: null,
    message: '',
    remainingSeconds: null,
  });
  stemStore.subscribe((v) => (stemState = v));

  const isStemsActive = $derived(stemState.status === 'ready' || stemState.status === 'processing');

  // Whether speed/pitch/EQ differ from defaults
  const isModified = $derived(ps.speed !== 1 || ps.pitch !== 0);
  const isEQModified = $derived(eq.some((g) => g !== 0));

  // Keyboard shortcuts
  function handleKeydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        playerStore.togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        playerStore.skip(-settings.skipDuration);
        break;
      case 'ArrowRight':
        e.preventDefault();
        playerStore.skip(settings.skipDuration);
        break;
      case 'KeyA':
        if (!e.ctrlKey && !e.metaKey) playerStore.setA();
        break;
      case 'KeyB':
        if (!e.ctrlKey && !e.metaKey) playerStore.setB();
        break;
      case 'KeyR':
        if (!e.ctrlKey && !e.metaKey) playerStore.toggleABRepeat();
        break;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if track}
  <div class="space-y-3 md:space-y-4">
    <!-- Track Info -->
    <div class="flex items-center gap-3 md:gap-4">
      {#if track.coverArt}
        <img src={track.coverArt} alt="" class="w-12 h-12 md:w-16 md:h-16 rounded-lg object-cover shadow-lg flex-shrink-0" />
      {:else}
        <div class="w-12 h-12 md:w-16 md:h-16 rounded-lg bg-surface-lighter flex items-center justify-center flex-shrink-0">
          <svg class="w-6 h-6 md:w-8 md:h-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" />
          </svg>
        </div>
      {/if}
      <div class="flex-1 min-w-0">
        <h2 class="text-base md:text-lg font-bold truncate">{track.title}</h2>
        <p class="text-xs md:text-sm text-text-muted truncate">{track.artist}</p>
      </div>
    </div>

    <!-- Waveform -->
    <Waveform />

    <!-- Controls -->
    <Controls />

    <!-- Speed & Pitch (collapsible) -->
    <div>
      <button
        class="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors
          {showPlaySettings
            ? 'bg-primary/15 text-primary'
            : isModified
              ? 'bg-surface-lighter text-text'
              : 'bg-surface-light text-text-muted hover:bg-surface-lighter hover:text-text'}"
        onclick={() => (showPlaySettings = !showPlaySettings)}
      >
        <span class="flex items-center gap-3">
          <span>速度 <span class="font-mono font-medium">{ps.speed.toFixed(2)}x</span></span>
          <span class="opacity-40">|</span>
          <span>ピッチ <span class="font-mono font-medium">{ps.pitch > 0 ? '+' : ''}{ps.pitch}</span></span>
          <span class="opacity-40">|</span>
          <span>スキップ <span class="font-mono font-medium">{settings.skipDuration}秒</span></span>
          {#if isModified}
            <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary leading-none">変更中</span>
          {/if}
        </span>
        <svg
          class="w-4 h-4 transition-transform duration-200 {showPlaySettings ? 'rotate-180' : ''}"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7" />
        </svg>
      </button>
      {#if showPlaySettings}
        <div class="mt-2 space-y-2">
          <SpeedPitch />
          <!-- Skip duration -->
          <div class="bg-surface-light rounded-lg p-3">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs text-text-muted">スキップ秒数</span>
              <span class="text-sm font-mono font-medium">{settings.skipDuration}秒</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              {#each [1, 2, 3, 5, 10, 15, 30] as opt}
                <button
                  class="flex-1 py-1.5 text-xs rounded transition-colors
                    {settings.skipDuration === opt ? 'bg-primary text-white' : 'bg-surface-lighter hover:bg-surface-lighter/80 text-text-muted'}"
                  onclick={() => settingsStore.setSkipDuration(opt)}
                >
                  {opt}秒
                </button>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- A-B Repeat -->
    <ABRepeat />

    <!-- Loop Bookmarks -->
    <LoopBookmarks />

    <!-- EQ toggle button -->
    <button
      class="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors
        {showEQ
          ? 'bg-primary/15 text-primary'
          : isEQModified
            ? 'bg-surface-lighter text-text'
            : 'bg-surface-light text-text-muted hover:bg-surface-lighter hover:text-text'}"
      onclick={() => (showEQ = !showEQ)}
    >
      <span class="flex items-center gap-2">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 7h4m0 0a2 2 0 1 0 4 0m-4 0a2 2 0 1 1 4 0m0 0h10M3 12h10m0 0a2 2 0 1 0 4 0m-4 0a2 2 0 1 1 4 0m0 0h4M3 17h4m0 0a2 2 0 1 0 4 0m-4 0a2 2 0 1 1 4 0m0 0h10" />
        </svg>
        <span>EQ</span>
        {#if isEQModified}
          <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary leading-none">変更中</span>
        {/if}
      </span>
      <svg
        class="w-4 h-4 transition-transform duration-200 {showEQ ? 'rotate-180' : ''}"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7" />
      </svg>
    </button>
    {#if showEQ}
      <EQPanel />
    {/if}

    <!-- Stem Mixer toggle button -->
    <button
      class="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors
        {showStems
          ? 'bg-primary/15 text-primary'
          : isStemsActive
            ? 'bg-surface-lighter text-text'
            : 'bg-surface-light text-text-muted hover:bg-surface-lighter hover:text-text'}"
      onclick={() => (showStems = !showStems)}
    >
      <span class="flex items-center gap-2">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
        </svg>
        <span>ステムミキサー</span>
        {#if stemState.status === 'ready'}
          <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary leading-none">分離済み</span>
        {:else if stemState.status === 'processing'}
          <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 leading-none">処理中</span>
        {/if}
      </span>
      <svg
        class="w-4 h-4 transition-transform duration-200 {showStems ? 'rotate-180' : ''}"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7" />
      </svg>
    </button>
    {#if showStems}
      <StemMixer />
    {/if}

    <!-- Analysis info: BPM + Chords (β) -->
    <ChordDisplay />
  </div>
{:else}
  <div class="flex items-center justify-center h-48 md:h-64 text-text-muted">
    <div class="text-center">
      <svg class="mx-auto h-10 w-10 md:h-12 md:w-12 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
        <path stroke-linecap="round" stroke-linejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" />
      </svg>
      <p class="text-sm">トラックを選択してください</p>
      <p class="text-xs mt-1 md:hidden">左上のリストアイコンから曲を追加</p>
    </div>
  </div>
{/if}
