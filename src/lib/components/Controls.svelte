<script lang="ts">
  import { playerStore } from '../stores/playerStore';
  import { settingsStore } from '../stores/settingsStore';
  import type { PlayerState, AppSettings } from '../types';

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

  let settings: AppSettings = $state({ 
    skipDuration: 5, 
    defaultSpeed: 1, 
    defaultPitch: 0,
    keepAwake: false,
    apiEndpoint: '',
    apiKey: '',
  });

  playerStore.subscribe((v) => (ps = v));
  settingsStore.subscribe((v) => (settings = v));

  function formatTime(sec: number): string {
    if (!sec || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
</script>

<div class="space-y-2">
  <!-- Time display (top) -->
  <div class="flex items-center justify-center gap-2 text-xs text-text-muted font-mono">
    <span>{formatTime(ps.currentTime)} / {formatTime(ps.duration)}</span>
  </div>

  <!-- Play controls row -->
  <div class="flex items-center justify-center gap-1 md:gap-2">
    <!-- Skip back -->
    <button
      class="p-2.5 md:p-2 rounded-lg hover:bg-surface-lighter active:bg-surface-lighter transition-colors text-text-muted hover:text-text relative"
      onclick={() => playerStore.skip(-settings.skipDuration)}
      title="{settings.skipDuration}秒戻る"
    >
      <svg class="w-6 h-6 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 16.811c0 .864-.933 1.406-1.683.977l-7.108-4.062a1.125 1.125 0 0 1 0-1.953l7.108-4.062A1.125 1.125 0 0 1 21 8.689v8.122ZM11.25 16.811c0 .864-.933 1.406-1.683.977l-7.108-4.062a1.125 1.125 0 0 1 0-1.953l7.108-4.062a1.125 1.125 0 0 1 1.683.977v8.122Z" />
      </svg>
      <span class="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[9px] text-text-muted">{settings.skipDuration}s</span>
    </button>

    <!-- Play / Pause -->
    <button
      class="p-4 md:p-3 rounded-full bg-primary hover:bg-primary-hover active:bg-primary-hover transition-colors text-white disabled:opacity-50"
      onclick={() => playerStore.togglePlay()}
      disabled={!ps.trackId}
    >
      {#if ps.isPlaying}
        <svg class="w-7 h-7 md:w-6 md:h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
        </svg>
      {:else}
        <svg class="w-7 h-7 md:w-6 md:h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      {/if}
    </button>

    <!-- Skip forward -->
    <button
      class="p-2.5 md:p-2 rounded-lg hover:bg-surface-lighter active:bg-surface-lighter transition-colors text-text-muted hover:text-text relative"
      onclick={() => playerStore.skip(settings.skipDuration)}
      title="{settings.skipDuration}秒進む"
    >
      <svg class="w-6 h-6 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.062a1.125 1.125 0 0 1 0 1.953l-7.108 4.062A1.125 1.125 0 0 1 3 16.811V8.69ZM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.062a1.125 1.125 0 0 1 0 1.953l-7.108 4.062a1.125 1.125 0 0 1-1.683-.977V8.69Z" />
      </svg>
      <span class="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[9px] text-text-muted">{settings.skipDuration}s</span>
    </button>

  </div>
</div>
