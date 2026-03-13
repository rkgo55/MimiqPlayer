<script lang="ts">
  import { playerStore } from '../stores/playerStore';
  import { getCurrentChord } from '../audio/AudioAnalyzer';
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

  playerStore.subscribe((v) => (ps = v));
  playerStore.chords.subscribe((v) => (chords = v));
  playerStore.bpm.subscribe((v) => (bpm = v));
  playerStore.key.subscribe((v) => (key = v));

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
  const isDetecting = $derived(ps.trackId !== null && chords.length === 0);
</script>

{#if ps.trackId}
  <div class="bg-surface-light rounded-lg p-3 space-y-2">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <span class="text-xs text-text-muted font-medium">解析情報</span>
      <span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-lighter text-text-muted/60 font-medium">β</span>
    </div>

    <div class="flex items-stretch gap-3">
      <!-- BPM -->
      <div class="flex flex-col items-center justify-center min-w-[48px]">
        {#if bpm > 0}
          <div class="text-xl font-bold text-text leading-tight">{bpm}</div>
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
          {@const [root, mode] = key.split(' ')}
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
          <div class="text-xl font-bold text-primary leading-tight">{currentChord}</div>
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
              <span class="text-xs font-semibold text-text">{upcoming.chord}</span>
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
