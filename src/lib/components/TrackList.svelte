<script lang="ts">
  import { trackStore, selectedTrack } from '../stores/trackStore';
  import { playerStore } from '../stores/playerStore';
  import type { TrackMeta } from '../types';

  let tracks: TrackMeta[] = $state([]);
  let selected: TrackMeta | null = $state(null);

  trackStore.subscribe((v) => (tracks = v));
  selectedTrack.subscribe((v) => (selected = v));

  async function selectTrack(track: TrackMeta) {
    trackStore.select(track.id);
    await playerStore.loadTrack(track.id);
  }

  async function removeTrack(e: Event, id: string) {
    e.stopPropagation();
    if (confirm('このトラックを削除しますか？')) {
      await trackStore.deleteTrack(id);
    }
  }

  function formatDuration(sec: number): string {
    if (!sec) return '--:--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
</script>

{#if tracks.length > 0}
  <div class="space-y-1 max-h-[300px] overflow-y-auto">
    {#each tracks as track (track.id)}
      <div
        class="w-full flex items-center gap-3 p-2 rounded-lg transition-colors cursor-pointer
          {selected?.id === track.id ? 'bg-primary/20 border border-primary/30' : 'hover:bg-surface-lighter border border-transparent'}"
        role="button"
        tabindex="0"
        onclick={() => selectTrack(track)}
        onkeydown={(e) => e.key === 'Enter' && selectTrack(track)}
      >
        <!-- Cover Art -->
        {#if track.coverArt}
          <img src={track.coverArt} alt="" class="w-10 h-10 rounded object-cover flex-shrink-0" />
        {:else}
          <div class="w-10 h-10 rounded bg-surface-lighter flex items-center justify-center flex-shrink-0">
            <svg class="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" />
            </svg>
          </div>
        {/if}

        <!-- Track Info -->
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">{track.title}</p>
          <p class="text-xs text-text-muted truncate">{track.artist}</p>
        </div>

        <!-- Duration -->
        <span class="text-xs text-text-muted flex-shrink-0">
          {formatDuration(track.duration)}
        </span>

        <!-- Delete button -->
        <button
          class="flex-shrink-0 p-1 rounded hover:bg-danger/20 text-text-muted hover:text-danger transition-colors"
          onclick={(e) => removeTrack(e, track.id)}
          title="削除"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
        </button>
      </div>
    {/each}
  </div>
{/if}
