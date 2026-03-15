<script lang="ts">
  import { playerStore, analyzingTrackId as analyzingTrackIdStore, AI_DURATION_LIMIT_ERROR } from '../stores/playerStore';
  import { getCurrentChord } from '../audio/AudioAnalyzer';
  import { transposeKey, transposeChord } from '../audio/chordUtils';
  import type { PlayerState } from '../types';
  import type { ChordInfo } from '../audio/AudioAnalyzer';

  let ps: PlayerState = $state({
    trackId: null, isPlaying: false, currentTime: 0, duration: 0,
    speed: 1, pitch: 0, volume: 1,
    abRepeat: { enabled: false, a: null, b: null },
  });
  let chords: ChordInfo[] = $state([]);
  let bpm = $state(0);
  let key = $state('');
  let _analyzingTrackId = $state<string | null>(null);
  const isAnalyzing = $derived(_analyzingTrackId !== null && _analyzingTrackId === ps.trackId);
  let aiError = $state<string | null>(null);

  // Reset error when track changes
  $effect(() => { ps.trackId; aiError = null; })

  playerStore.subscribe((v) => { ps = v; });
  playerStore.chords.subscribe((v) => (chords = v));
  playerStore.bpm.subscribe((v) => (bpm = v));
  playerStore.key.subscribe((v) => (key = v));
  analyzingTrackIdStore.subscribe((v) => (_analyzingTrackId = v));

  /** Format chord label: remove Harte-notation colon (e.g. "C:min" → "Cmin") */
  function fmtChord(chord: string): string {
    return chord.replace(':', '');
  }

  const displayKey = $derived(transposeKey(key, ps.pitch));

  function displayChord(chord: string): string {
    return fmtChord(transposeChord(chord, ps.pitch));
  }

  /** Whether data is absent and not yet requested */
  const needsAnalysis = $derived(ps.trackId !== null && chords.length === 0 && bpm === 0);

  const currentChord = $derived(
    chords.length > 0 ? getCurrentChord(chords, ps.currentTime) : ''
  );

  /** Upcoming chords (deduplicate consecutive same chords, show next 3 distinct) */
  const upcomingChords = $derived.by(() => {
    if (chords.length === 0) return [];
    const result: { chord: string; time: number }[] = [];
    let lastChord = currentChord;
    for (const c of chords) {
      if (c.time <= ps.currentTime) continue;
      if (c.chord === lastChord || c.chord === 'N') continue;
      result.push(c);
      lastChord = c.chord;
      if (result.length >= 3) break;
    }
    return result;
  });

  /** Whether chord detection is still in progress */
  const isDetecting = $derived(ps.trackId !== null && chords.length === 0 && !needsAnalysis);

  async function handleAnalyze() {
    if (isAnalyzing || !ps.trackId) return;
    aiError = null;
    try {
      await playerStore.analyzeTrack();
    } catch (e) {
      if (e instanceof Error && e.message === AI_DURATION_LIMIT_ERROR) {
        aiError = '10分を超える楽曲はAI解析に対応していません';
      }
    }
  }
</script>

{#if ps.trackId}
  <div class="bg-surface-light rounded-lg p-3 space-y-2">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <span class="text-xs text-text-muted font-medium">解析情報</span>
      <div class="flex items-center gap-1.5">
        {#if needsAnalysis}
          <button
            class="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onclick={handleAnalyze}
            disabled={isAnalyzing}
            title="BPM・キー・コードを解析"
          >
            {#if isAnalyzing}
              <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              解析中…
            {:else}
              <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
              </svg>
              解析
            {/if}
          </button>
        {/if}
      </div>
    </div>

    {#if isAnalyzing}
      <p class="text-[11px] text-text-muted opacity-70">数分かかる場合があります・処理中はアプリを閉じないでください</p>
    {/if}
    {#if aiError}
      <p class="text-[11px] text-red-400">{aiError}</p>
    {/if}

    <div class="flex items-stretch gap-3">
      <!-- BPM -->
      <div class="flex flex-col items-center justify-center min-w-[48px]">
        {#if bpm > 0}
          <div class="text-xl font-bold text-text leading-tight">{Math.round(bpm)}</div>
          <div class="text-[10px] text-text-muted mt-0.5">BPM</div>
        {:else}
          <div class="text-xl font-bold text-text-muted/30 leading-tight animate-pulse">—</div>
          <div class="text-[10px] text-text-muted mt-0.5">BPM</div>
        {/if}
      </div>

      <!-- Divider -->
      <div class="w-px bg-surface-lighter flex-shrink-0 self-stretch"></div>

      <!-- Key -->
      <div class="flex flex-col items-center justify-center min-w-[52px]">
        {#if key}
          {@const [root, mode] = displayKey.split(' ')}
          <div class="text-base font-bold text-text leading-tight">{root}</div>
          <div class="text-[10px] text-text-muted mt-0.5">{mode === 'major' ? 'メジャー' : 'マイナー'}</div>
        {:else}
          <div class="text-base font-bold text-text-muted/30 leading-tight animate-pulse">—</div>
          <div class="text-[10px] text-text-muted mt-0.5">キー</div>
        {/if}
      </div>

      <!-- Divider -->
      <div class="w-px bg-surface-lighter flex-shrink-0 self-stretch"></div>

      <!-- Current chord -->
      <div class="flex flex-col items-center justify-center min-w-[48px]">
        {#if isDetecting}
          <div class="text-xl font-bold text-text-muted/30 leading-tight animate-pulse">—</div>
          <div class="text-[10px] text-text-muted mt-0.5">コード</div>
        {:else if currentChord && currentChord !== 'N'}
          <div class="text-xl font-bold text-primary leading-tight">{displayChord(currentChord)}</div>
          <div class="text-[10px] text-text-muted mt-0.5">コード</div>
        {:else}
          <div class="text-xl font-bold text-text-muted/30 leading-tight">—</div>
          <div class="text-[10px] text-text-muted mt-0.5">コード</div>
        {/if}
      </div>

      <!-- Divider -->
      <div class="w-px bg-surface-lighter flex-shrink-0 self-stretch"></div>

      <!-- Upcoming chords -->
      <div class="flex items-center gap-2 flex-1 min-w-0 pl-1">
        {#if upcomingChords.length > 0 && !isDetecting}
          {#each upcomingChords as upcoming, i (upcoming.time)}
            <div
              class="flex flex-col items-center flex-shrink-0"
              style="opacity: {i === 0 ? 0.75 : i === 1 ? 0.45 : 0.25}"
            >
              <span class="text-xs font-semibold text-text">{displayChord(upcoming.chord)}</span>
              <span class="text-[9px] text-text-muted">{Math.ceil(upcoming.time - ps.currentTime)}s</span>
            </div>
            {#if i < upcomingChords.length - 1}
              <svg class="w-2.5 h-2.5 text-text-muted/30 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="m9 18 6-6-6-6" />
              </svg>
            {/if}
          {/each}
        {:else if isDetecting}
          <span class="text-xs text-text-muted/40 animate-pulse">解析中...</span>
        {:else}
          <span class="text-xs text-text-muted/30">—</span>
        {/if}
      </div>
    </div>
  </div>
{/if}
