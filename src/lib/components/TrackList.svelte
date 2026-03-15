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

  // ── Drag & touch reorder ──────────────────────────────────────────────────
  let dragFromIndex = $state<number | null>(null);
  let dragOverIndex = $state<number | null>(null);

  function onDragStart(i: number) { dragFromIndex = i; }
  function onDragOver(e: DragEvent, i: number) { e.preventDefault(); dragOverIndex = i; }
  function onDragEnd() { dragFromIndex = null; dragOverIndex = null; }

  function applyReorder(from: number, to: number) {
    if (from === to) return;
    const reordered = [...tracks];
    const [item] = reordered.splice(from, 1);
    reordered.splice(to, 0, item);
    void trackStore.reorder(reordered);
  }

  function onDrop(i: number) {
    if (dragFromIndex === null) { dragOverIndex = null; return; }
    applyReorder(dragFromIndex, i);
    dragFromIndex = null;
    dragOverIndex = null;
  }

  function indexFromPoint(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y);
    let target: Element | null = el;
    while (target) {
      const idx = target.getAttribute('data-track-index');
      if (idx !== null) return parseInt(idx, 10);
      target = target.parentElement;
    }
    return null;
  }

  function onTouchStart(e: TouchEvent, i: number) { dragFromIndex = i; }

  function onTouchMove(e: TouchEvent) {
    if (dragFromIndex === null) return;
    e.preventDefault();
    const t = e.touches[0];
    const idx = indexFromPoint(t.clientX, t.clientY);
    if (idx !== null) dragOverIndex = idx;
  }

  function onTouchEnd() {
    if (dragFromIndex !== null && dragOverIndex !== null && dragFromIndex !== dragOverIndex) {
      applyReorder(dragFromIndex, dragOverIndex);
    }
    dragFromIndex = null;
    dragOverIndex = null;
  }

  let listEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!listEl) return;
    listEl.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => listEl?.removeEventListener('touchmove', onTouchMove);
  });
</script>

{#if tracks.length > 0}
  <div class="space-y-1" bind:this={listEl}>
    {#each tracks as track, i (track.id)}
      {@const isDragOver = dragOverIndex === i && dragFromIndex !== i}
      <div
        class="transition-opacity {dragFromIndex === i ? 'opacity-40' : 'opacity-100'}"
        data-track-index={i}
        draggable="true"
        role="listitem"
        ondragstart={() => onDragStart(i)}
        ondragover={(e) => onDragOver(e, i)}
        ondrop={() => onDrop(i)}
        ondragend={onDragEnd}
      >
        {#if isDragOver && dragFromIndex !== null && dragFromIndex > i}
          <div class="h-0.5 rounded bg-primary/60 mx-1 mb-1"></div>
        {/if}
        <div
          class="w-full flex items-center gap-2 p-2 rounded-lg transition-colors cursor-pointer
            {selected?.id === track.id ? 'bg-primary/20 border border-primary/30' : 'hover:bg-surface-lighter border border-transparent'}"
          role="button"
          tabindex="0"
          onclick={() => selectTrack(track)}
          onkeydown={(e) => e.key === 'Enter' && selectTrack(track)}
        >
          <!-- Drag handle -->
          <span
            class="flex-shrink-0 cursor-grab active:cursor-grabbing text-text-muted/30 hover:text-text-muted/60 select-none"
            role="button"
            tabindex="0"
            aria-label="ドラッグして並び替え"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
            ontouchstart={(e) => { e.stopPropagation(); onTouchStart(e, i); }}
            ontouchend={(e) => { e.stopPropagation(); onTouchEnd(); }}
          >
            <svg class="w-3 h-5 pointer-events-none" viewBox="0 0 6 14" fill="currentColor">
              <circle cx="1.5" cy="2" r="1.2"/><circle cx="4.5" cy="2" r="1.2"/>
              <circle cx="1.5" cy="7" r="1.2"/><circle cx="4.5" cy="7" r="1.2"/>
              <circle cx="1.5" cy="12" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/>
            </svg>
          </span>

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
        {#if isDragOver && dragFromIndex !== null && dragFromIndex < i}
          <div class="h-0.5 rounded bg-primary/60 mx-1 mt-1"></div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
