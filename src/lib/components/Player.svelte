<script lang="ts">
  import { selectedTrack, trackStore } from '../stores/trackStore';
  import { playerStore, analyzingStructureTrackId as analyzingStructureTrackIdStore, trimStart as trimStartStore, trimEnd as trimEndStore, AI_DURATION_LIMIT_ERROR } from '../stores/playerStore';
  import { settingsStore } from '../stores/settingsStore';
  import { stemStore, type StemState } from '../stores/stemStore';
  import { get } from 'svelte/store';
  import Waveform from './Waveform.svelte';
  import Controls from './Controls.svelte';
  import SpeedPitch from './SpeedPitch.svelte';
  import ABRepeat from './ABRepeat.svelte';
  import EQPanel from './EQPanel.svelte';
  import LoopBookmarks from './LoopBookmarks.svelte';
  import ChordDisplay from './ChordDisplay.svelte';
  import StemMixer from './StemMixer.svelte';
  import type { TrackMeta, AppSettings, PlayerState, EQBands, LoopBookmark } from '../types';
  import { EQ_FLAT } from '../types';
  import { exportTrackAsZip, downloadBlob } from '../storage/trackExport';

  let track: TrackMeta | null = $state(null);
  let settings: AppSettings = $state({ skipDuration: 5, defaultSpeed: 1, defaultPitch: 0, stemModel: 'htdemucs-6s', keepAwake: false, apiEndpoint: '', apiKey: '' });
  let ps: PlayerState = $state({
    trackId: null, isPlaying: false, currentTime: 0, duration: 0,
    speed: 1, pitch: 0, volume: 1,
    abRepeat: { enabled: false, a: null, b: null },
  });
  let showPlaySettings = $state(false);
  let showBookmarks = $state(false);
  let bookmarksIsAdding = $state(false);
  let showEQ = $state(false);
  let showStems = $state(false);
  let editingTrackInfo = $state(false);
  let editTitle = $state('');
  let editArtist = $state('');
  let isExporting = $state(false);
  let exportError = $state<string | null>(null);
  let showExportModal = $state(false);

  // Audio cutter
  let showTrimmer = $state(false);
  let isTrimming = $state(false);
  let _trimStart = $state(0);
  let _trimEnd = $state<number | null>(null);
  let autoBookmarksError = $state<string | null>(null);
  trimStartStore.subscribe((v) => (_trimStart = v));
  trimEndStore.subscribe((v) => (_trimEnd = v));

  const canSaveAB = $derived(ps.abRepeat.a !== null && ps.abRepeat.b !== null);

  function startEditTrackInfo() {
    if (!track) return;
    editTitle = track.title;
    editArtist = track.artist;
    editingTrackInfo = true;
  }

  async function saveTrackInfo() {
    if (!track) return;
    await trackStore.updateTrackInfo(track.id, {
      title: editTitle.trim() || track.title,
      artist: editArtist.trim(),
    });
    editingTrackInfo = false;
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  async function handleApplyTrim() {
    if (isTrimming) return;
    const start = _trimStart;
    const end = _trimEnd ?? ps.duration;
    if (end - start < 0.5) return;
    isTrimming = true;
    prevTrackId = null; // force stemStore.onTrackLoaded to re-run after reload
    try {
      await playerStore.trimAudio(start, end);
      showTrimmer = false;
    } finally {
      isTrimming = false;
    }
  }

  function cancelTrim() {
    trimStartStore.set(0);
    trimEndStore.set(null);
    showTrimmer = false;
  }

  function handleExport() {
    if (!track) return;
    showExportModal = true;
  }

  async function confirmExport() {
    if (!track || isExporting) return;
    isExporting = true;
    exportError = null;
    try {
      const { blob, fileName } = await exportTrackAsZip(track.id);
      downloadBlob(blob, fileName);
      showExportModal = false;
    } catch (e) {
      console.error('Export failed:', e);
      exportError = e instanceof Error ? e.message : 'エクスポートに失敗しました';
    } finally {
      isExporting = false;
    }
  }
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

  let bookmarks: LoopBookmark[] = $state([]);
  playerStore.bookmarks.subscribe((v) => (bookmarks = v));

  let analyzingBookmarksTrackId = $state<string | null>(null);
  const isAnalyzingBookmarks = $derived(analyzingBookmarksTrackId !== null && analyzingBookmarksTrackId === ps.trackId);

  // Subscribe to store-level structure analyzing state so reload restores the spinner
  analyzingStructureTrackIdStore.subscribe((v) => { analyzingBookmarksTrackId = v; });

  async function handleAutoBookmarks() {
    if (isAnalyzingBookmarks || !ps.trackId) return;
    const tid = ps.trackId;
    showBookmarks = true;
    autoBookmarksError = null;
    try {
      // If stems aren't ready yet and the API is configured, separate first
      const apiEndpoint = get(settingsStore).apiEndpoint;
      if (stemState.status !== 'ready' && apiEndpoint) {
        await stemStore.separate(ps.trackId);
        // Abort structure analysis if separation failed
        if (get(stemStore).status === 'error') return;
      }
      await playerStore.autoBookmarks();
      showBookmarks = true;
    } catch (e) {
      if (e instanceof Error && e.message === AI_DURATION_LIMIT_ERROR) {
        autoBookmarksError = '10分を超える楽曲はAI解析に対応していません';
      }
    } finally {
      // store is cleared by playerStore; no local cleanup needed
    }
  }

  // Stem state
  let stemState: StemState = $state({
    status: 'none',
    volumes: { vocals: 1, drums: 1, bass: 1, other: 1, guitar: 1, piano: 1 },
    downloadProgress: null,
    message: '',
    remainingSeconds: null,
    loadedStems: null,
    backend: null,
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
    <div class="relative flex items-center gap-3 md:gap-4">
      {#if track.coverArt}
        <img src={track.coverArt} alt="" class="w-12 h-12 md:w-16 md:h-16 rounded-lg object-cover shadow-lg flex-shrink-0" />
      {:else}
        <div class="w-12 h-12 md:w-16 md:h-16 rounded-lg bg-surface-lighter flex items-center justify-center flex-shrink-0">
          <svg class="w-6 h-6 md:w-8 md:h-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" />
          </svg>
        </div>
      {/if}

      {#if editingTrackInfo}
        <div class="flex-1 min-w-0 space-y-1.5">
          <input
            class="w-full text-sm font-bold bg-surface-lighter px-2 py-1 rounded border border-primary/40 outline-none text-text placeholder:text-text-muted"
            placeholder="タイトル"
            bind:value={editTitle}
            onkeydown={(e) => { if (e.key === 'Enter') saveTrackInfo(); if (e.key === 'Escape') editingTrackInfo = false; }}
          />
          <input
            class="w-full text-xs bg-surface-lighter px-2 py-1 rounded border border-white/10 outline-none text-text-muted placeholder:text-text-muted"
            placeholder="アーティスト"
            bind:value={editArtist}
            onkeydown={(e) => { if (e.key === 'Enter') saveTrackInfo(); if (e.key === 'Escape') editingTrackInfo = false; }}
          />
          <button
            class="w-full py-1 text-xs rounded bg-primary text-white hover:bg-primary/90 transition-colors"
            onclick={saveTrackInfo}
          >保存</button>
        </div>
      {:else}
        <div class="flex-1 min-w-0">
          <h2 class="text-base md:text-lg font-bold truncate">{track.title}</h2>
          <p class="text-xs md:text-sm text-text-muted truncate">{track.artist}</p>
        </div>
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <!-- Export button -->
          <button
            class="p-1.5 rounded hover:bg-surface-lighter text-text-muted/40 hover:text-primary transition-all"
            onclick={handleExport}
            title="トラックをエクスポート (.mimiqtrack.zip)"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
            </svg>
          </button>
          <!-- Edit button (pencil) -->
          <button
            class="p-1.5 rounded hover:bg-surface-lighter text-text-muted/40 hover:text-text-muted transition-all"
            onclick={startEditTrackInfo}
            title="曲名・アーティストを編集"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
            </svg>
          </button>
          <!-- Trim button -->
          <button
            class="p-1.5 rounded hover:bg-surface-lighter transition-all {showTrimmer ? 'text-amber-400 bg-amber-500/10' : 'text-text-muted/40 hover:text-amber-400'}"
            onclick={() => { showTrimmer = !showTrimmer; if (!showTrimmer) cancelTrim(); }}
            title="オーディオカッター"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M7.848 8.25l1.536.887M7.848 8.25a3 3 0 1 1-5.196-3 3 3 0 0 1 5.196 3Zm1.536.887a2.165 2.165 0 0 1 1.083 1.839c.005.351.054.695.14 1.024M9.384 9.137l2.077 1.199M7.848 15.75l1.536-.887m-1.536.887a3 3 0 1 1-5.196 3 3 3 0 0 1 5.196-3Zm1.536-.887a2.165 2.165 0 0 1 1.083-1.838c.005-.352.054-.695.14-1.025m-1.223 2.863 2.077-1.199m0-3.328a4.323 4.323 0 0 1 2.068-1.379l5.325-1.628a4.5 4.5 0 0 1 2.48-.044l.803.215-7.794 4.5m-2.882-1.664L10.979 8.937m-2.595 12.548 7.795-4.5m0 0 .808.215a4.5 4.5 0 0 0 1.053-8.803l-2.288-.701" />
            </svg>
          </button>
        </div>
      {/if}
    </div>

    <!-- Waveform -->
    <Waveform {showTrimmer} />

    <!-- Audio cutter controls -->
    {#if showTrimmer}
      <div class="bg-surface-light rounded-lg px-3 py-2 flex items-center gap-2">
        <svg class="w-3.5 h-3.5 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M7.848 8.25l1.536.887M7.848 8.25a3 3 0 1 1-5.196-3 3 3 0 0 1 5.196 3Zm1.536.887a2.165 2.165 0 0 1 1.083 1.839c.005.351.054.695.14 1.024M9.384 9.137l2.077 1.199M7.848 15.75l1.536-.887m-1.536.887a3 3 0 1 1-5.196 3 3 3 0 0 1 5.196-3Zm1.536-.887a2.165 2.165 0 0 1 1.083-1.838c.005-.352.054-.695.14-1.025m-1.223 2.863 2.077-1.199m0-3.328a4.323 4.323 0 0 1 2.068-1.379l5.325-1.628a4.5 4.5 0 0 1 2.48-.044l.803.215-7.794 4.5m-2.882-1.664L10.979 8.937m-2.595 12.548 7.795-4.5m0 0 .808.215a4.5 4.5 0 0 0 1.053-8.803l-2.288-.701" />
        </svg>
        <div class="flex items-center gap-1.5 text-xs font-mono flex-1 min-w-0">
          <span class="text-text-muted text-[10px]">IN</span>
          <span class="tabular-nums text-amber-300">{formatTime(_trimStart)}</span>
          <span class="text-text-muted/40 mx-0.5">—</span>
          <span class="text-text-muted text-[10px]">OUT</span>
          <span class="tabular-nums text-amber-300">{formatTime(_trimEnd ?? ps.duration)}</span>
        </div>
        <span class="text-[10px] text-text-muted/50 hidden sm:block flex-shrink-0">スクロールで拡大</span>
        <button
          class="flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors disabled:opacity-40 flex-shrink-0"
          onclick={handleApplyTrim}
          disabled={isTrimming || (_trimStart === 0 && (_trimEnd === null || (_trimEnd !== null && Math.abs(_trimEnd - ps.duration) < 0.05)))}
        >
          {#if isTrimming}
            <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          {/if}
          切り取り
        </button>
        <button
          class="p-1 text-text-muted/50 hover:text-text-muted rounded transition-colors flex-shrink-0"
          onclick={cancelTrim}
          title="キャンセル"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    {/if}

    <!-- Controls -->
    <Controls />

    <!-- Speed & Pitch (collapsible) -->
    <div class="rounded-lg overflow-hidden">
      <button
        class="w-full flex items-center justify-between px-3 py-2 text-sm transition-colors
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
        <div class="p-2 space-y-2 bg-surface-light">
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
          <!-- Keep awake toggle -->
          <div class="flex items-center justify-between bg-surface-light rounded-lg px-3 py-2">
            <div>
              <span class="text-xs text-text">常に画面をオンにする</span>
              <p class="text-[10px] text-text-muted leading-tight mt-0.5">再生中以外もスリープを防ぐ</p>
            </div>
            <button
              role="switch"
              aria-checked={settings.keepAwake}
              aria-label="常に画面をオンにする"
              class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors
                {settings.keepAwake ? 'bg-primary' : 'bg-surface-lighter'}"
              onclick={() => settingsStore.update((s) => ({ ...s, keepAwake: !s.keepAwake }))}
            >
              <span
                class="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform mt-0.5
                  {settings.keepAwake ? 'translate-x-4' : 'translate-x-0.5'}"
              ></span>
            </button>
          </div>
        </div>
      {/if}
    </div>

    <!-- A-B Repeat + Loop Bookmarks (combined box) -->
    <div class="bg-surface-light rounded-lg p-3 space-y-0">
      <ABRepeat bare />
      <div class="border-t border-white/5 mt-3 pt-2">
        <div class="flex items-center justify-between">
          <button
            class="flex items-center gap-1.5 text-xs transition-colors
              {showBookmarks ? 'text-primary' : 'text-text-muted hover:text-text'}"
            onclick={() => (showBookmarks = !showBookmarks)}
          >
            <span class="font-medium">ループブックマーク</span>
            <svg
              class="w-3.5 h-3.5 transition-transform duration-200 {showBookmarks ? 'rotate-180' : ''}"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7" />
            </svg>
          </button>
          <div class="flex items-center gap-1">
            {#if canSaveAB && !bookmarksIsAdding}
              <button
                class="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
                onclick={() => { showBookmarks = true; bookmarksIsAdding = true; }}
              >
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                保存
              </button>
            {/if}
          </div>
        </div>
        {#if showBookmarks}
          <div class="mt-2 space-y-2">
            {#if ps.trackId && bookmarks.length === 0 && !bookmarksIsAdding}
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs text-text-muted">AIで楽曲構造を解析してセクションを自動ブックマークします。</p>
                <button
                  class="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onclick={handleAutoBookmarks}
                  disabled={isAnalyzingBookmarks}
                  title="楽曲構造を解析してセクションを自動ブックマーク"
                >
                  {#if isAnalyzingBookmarks}
                    <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    解析中…
                  {:else}
                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                    </svg>
                    自動検出
                  {/if}
                </button>
              </div>
              {#if isAnalyzingBookmarks}
                <p class="text-[11px] text-text-muted opacity-70">数分かかる場合があります・処理中はアプリを閉じないでください</p>
              {/if}
              {#if autoBookmarksError}
                <p class="text-[11px] text-red-400 mt-1">{autoBookmarksError}</p>
              {/if}
            {/if}
            <LoopBookmarks bare bind:isAdding={bookmarksIsAdding} />
          </div>
        {/if}
      </div>
    </div>

    <!-- EQ -->
    <div class="rounded-lg overflow-hidden">
      <button
        class="w-full flex items-center justify-between px-3 py-2 text-sm transition-colors
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
    </div>

    <!-- Stem Mixer -->
    <div class="rounded-lg overflow-hidden">
      <button
        class="w-full flex items-center justify-between px-3 py-2 text-sm transition-colors
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
    </div>

    <!-- Analysis info: BPM + Chords -->
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

<!-- ── Export modal ──────────────────────────────────────────────────────── -->
{#if showExportModal && track}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onkeydown={(e) => { if (e.key === 'Escape' && !isExporting) showExportModal = false; }}
  >
    <!-- Panel -->
    <div class="bg-surface rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">

      <!-- Header -->
      <div class="flex items-center gap-3">
        <div class="flex-shrink-0 w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center">
          <svg class="w-4.5 h-4.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
          </svg>
        </div>
        <div>
          <h2 class="text-sm font-bold">トラックをエクスポート</h2>
          <p class="text-xs text-text-muted truncate max-w-52">{track.title}</p>
        </div>
      </div>

      <!-- What gets exported -->
      <div class="bg-surface-light rounded-xl p-3.5 space-y-2 text-xs text-text-muted">
        <p class="font-medium text-text">含まれるデータ</p>
        <ul class="space-y-1.5">
          <li class="flex items-start gap-2">
            <svg class="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
            元音源ファイル
          </li>
          {#if track.stemStatus === 'ready'}
            <li class="flex items-start gap-2">
              <svg class="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
              分離済みステム (ボーカル・ドラム・ベースなど)
            </li>
          {/if}
          <li class="flex items-start gap-2">
            <svg class="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
            EQ・ループブックマーク・解析情報
          </li>
        </ul>
      </div>

      <!-- Sharing guidance -->
      <div class="bg-primary/8 border border-primary/15 rounded-xl p-3.5 text-xs text-text-muted space-y-1">
        <p class="font-medium text-text flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5 text-primary/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9"/></svg>
          他のユーザーへ共有するには
        </p>
        <p>ダウンロードした <span class="font-mono text-text">.mimiqtrack.zip</span> ファイルをそのまま渡してください。</p>
        <p>受け取った側は、ファイルをアプリの<strong class="text-text">楽曲追加エリアにドロップ</strong>するか、タップして選択するだけでインポートできます。</p>
      </div>

      <!-- Error -->
      {#if exportError}
        <p class="text-xs text-danger bg-danger/10 rounded-lg px-3 py-2">{exportError}</p>
      {/if}

      <!-- Actions -->
      <div class="flex gap-2 pt-1">
        <button
          class="flex-1 py-2 text-sm rounded-xl border border-white/10 text-text-muted hover:bg-surface-lighter transition-colors disabled:opacity-40"
          onclick={() => { showExportModal = false; exportError = null; }}
          disabled={isExporting}
        >キャンセル</button>
        <button
          class="flex-1 py-2 text-sm rounded-xl bg-primary text-white hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          onclick={confirmExport}
          disabled={isExporting}
        >
          {#if isExporting}
            <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-30"/>
              <path fill="currentColor" class="opacity-80" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            作成中...
          {:else}
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/>
            </svg>
            ダウンロード
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
