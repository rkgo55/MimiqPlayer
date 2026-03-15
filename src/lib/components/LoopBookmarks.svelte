<script lang="ts">
  import { playerStore } from '../stores/playerStore';
  import type { PlayerState, LoopBookmark } from '../types';

  let { bare = false, isAdding = $bindable(false) }: { bare?: boolean; isAdding?: boolean } = $props();

  let ps: PlayerState = $state({
    trackId: null, isPlaying: false, currentTime: 0, duration: 0,
    speed: 1, pitch: 0, volume: 1,
    abRepeat: { enabled: false, a: null, b: null },
  });
  let bookmarks: LoopBookmark[] = $state([]);
  let savingLabel = $state('');
  let isAnalyzing = $state(false);
  /** ID of the bookmark currently being edited, or null */
  let editingId = $state<string | null>(null);
  let editingLabel = $state('');
  let editingA = $state(0);
  let editingB = $state(0);

  let dragFromIndex = $state<number | null>(null);
  let dragOverIndex = $state<number | null>(null);

  playerStore.subscribe((v) => (ps = v));
  playerStore.bookmarks.subscribe((v) => (bookmarks = v));

  function onDragStart(i: number) {
    dragFromIndex = i;
  }

  function onDragOver(e: DragEvent, i: number) {
    e.preventDefault();
    dragOverIndex = i;
  }

  function applyReorder(from: number, to: number) {
    if (from === to) return;
    const reordered = [...bookmarks];
    const [item] = reordered.splice(from, 1);
    reordered.splice(to, 0, item);
    void playerStore.reorderBookmarks(reordered);
  }

  function onDrop(i: number) {
    if (dragFromIndex === null || dragFromIndex === i) {
      dragFromIndex = null;
      dragOverIndex = null;
      return;
    }
    applyReorder(dragFromIndex, i);
    dragFromIndex = null;
    dragOverIndex = null;
  }

  function onDragEnd() {
    dragFromIndex = null;
    dragOverIndex = null;
  }

  // ---- Touch drag (mobile) ----
  function indexFromPoint(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    let target: Element | null = el;
    while (target) {
      const idx = target.getAttribute('data-bm-index');
      if (idx !== null) return parseInt(idx, 10);
      target = target.parentElement;
    }
    return null;
  }

  function onTouchStart(e: TouchEvent, i: number) {
    dragFromIndex = i;
  }

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

  // listEl は touchmove を passive:false で登録するために使用
  let listEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!listEl) return;
    listEl.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => listEl?.removeEventListener('touchmove', onTouchMove);
  });

  function formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /** 小数点1桁付き表示 (編集パネル用) */
  function formatTimeDec(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1);
    return `${m}:${s.padStart(4, '0')}`;
  }

  const canSave = $derived(ps.abRepeat.a !== null && ps.abRepeat.b !== null);

  async function handleSave() {
    if (!canSave) return;
    const label = savingLabel.trim() || `ループ ${bookmarks.length + 1}`;
    await playerStore.saveBookmark(label);
    savingLabel = '';
    isAdding = false;
  }

  function startEdit(bm: LoopBookmark) {
    editingId = bm.id;
    editingLabel = bm.label;
    editingA = bm.a;
    editingB = bm.b;
  }

  function cancelEdit() {
    editingId = null;
    editingLabel = '';
  }

  function clampA(v: number, duration: number) {
    return Math.max(0, Math.min(editingB - 0.1, Math.round(v * 10) / 10));
  }
  function clampB(v: number, duration: number) {
    return Math.max(editingA + 0.1, Math.min(duration, Math.round(v * 10) / 10));
  }

  async function handleUpdate(id: string) {
    await playerStore.updateBookmark(id, editingLabel, editingA, editingB);
    cancelEdit();
  }
</script>

{#if bookmarks.length > 0 || canSave || ps.trackId}
  <div class="{bare ? '' : 'bg-surface-light rounded-lg p-3'} space-y-2">
    <div class="flex items-center justify-between gap-1">
      {#if !bare}
        <span class="text-xs text-text-muted font-medium">ループブックマーク</span>
      {/if}
      <div class="flex items-center {bare ? 'w-full justify-end' : ''} gap-1">
        {#if !bare && canSave && !isAdding && editingId === null}
          <button
            class="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
            onclick={() => (isAdding = true)}
          >
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            現在のA-Bを保存
          </button>
        {/if}
      </div>
    </div>

    <!-- Save input -->
    {#if isAdding}
      <div class="flex gap-1.5">
        <input
          class="flex-1 text-xs bg-surface px-2 py-1.5 rounded border border-primary/40 outline-none text-text placeholder:text-text-muted"
          placeholder="名前（省略可）"
          bind:value={savingLabel}
          onkeydown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') { isAdding = false; savingLabel = ''; }
          }}
        />
        <button
          class="px-3 py-1.5 text-xs rounded bg-primary text-white hover:bg-primary/90 transition-colors"
          onclick={handleSave}
        >保存</button>
        <button
          class="px-2 py-1.5 text-xs rounded bg-surface-lighter text-text-muted hover:bg-surface-lighter/80 transition-colors"
          onclick={() => { isAdding = false; savingLabel = ''; }}
        >キャンセル</button>
      </div>
    {/if}

    <!-- Bookmark list -->
    {#if bookmarks.length > 0}
      <div class="space-y-1" bind:this={listEl}>
        {#each bookmarks as bm, i (bm.id)}
          {@const isActive = ps.abRepeat.a === bm.a && ps.abRepeat.b === bm.b}
          {@const isEditing = editingId === bm.id}
          {@const isDragOver = dragOverIndex === i && dragFromIndex !== i}
          <div
            class="space-y-1 transition-opacity {dragFromIndex === i ? 'opacity-40' : 'opacity-100'}"
            data-bm-index={i}
            draggable="true"
            role="listitem"
            ondragstart={() => onDragStart(i)}
            ondragover={(e) => onDragOver(e, i)}
            ondrop={() => onDrop(i)}
            ondragend={onDragEnd}
          >
            <!-- drop indicator -->
            {#if isDragOver && dragFromIndex !== null && dragFromIndex > i}
              <div class="h-0.5 rounded bg-primary/60 mx-1"></div>
            {/if}
            <div class="flex items-center gap-2">
              <!-- drag handle (mouse + touch) -->
              <span
                class="flex-shrink-0 cursor-grab active:cursor-grabbing text-text-muted/30 hover:text-text-muted/60 select-none"
                role="button"
                tabindex="0"
                aria-label="ドラッグして並び替え"
                ontouchstart={(e) => onTouchStart(e, i)}
                ontouchend={onTouchEnd}
              >
                <svg class="w-4 h-5 pointer-events-none" viewBox="0 0 8 14" fill="currentColor">
                  <circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/>
                  <circle cx="2" cy="7" r="1.2"/><circle cx="6" cy="7" r="1.2"/>
                  <circle cx="2" cy="12" r="1.2"/><circle cx="6" cy="12" r="1.2"/>
                </svg>
              </span>
              <button
                class="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors
                  {isEditing ? 'bg-primary/10 text-primary ring-1 ring-primary/30' : isActive ? 'bg-primary/20 text-primary' : 'bg-surface-lighter hover:bg-surface-lighter/80 text-text'}"
                onclick={() => !isEditing && playerStore.loadBookmark(bm)}
                title={isEditing ? undefined : 'クリックで読み込み'}
              >
                <span class="truncate font-medium">{bm.label}</span>
                <span class="font-mono text-text-muted ml-2 flex-shrink-0">
                  {formatTime(bm.a)} → {formatTime(bm.b)}
                </span>
              </button>
              <!-- Edit button -->
              <button
                class="flex-shrink-0 p-1 rounded transition-all {isEditing ? 'bg-primary/20 text-primary' : 'text-text-muted/50 hover:bg-surface-lighter hover:text-text'}"
                onclick={() => isEditing ? cancelEdit() : startEdit(bm)}
                title={isEditing ? '編集キャンセル' : '編集'}
              >
                {#if isEditing}
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                {:else}
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                  </svg>
                {/if}
              </button>
              <!-- Delete button -->
              <button
                class="flex-shrink-0 p-1 rounded hover:bg-danger/15 text-text-muted/50 hover:text-danger transition-all"
                onclick={() => {
                  if (confirm(`「${bm.label}」を削除しますか？`)) {
                    playerStore.deleteBookmark(bm.id);
                  }
                }}
                title="削除"
              >
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m19 7-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>

            <!-- drop indicator (below) -->
            {#if isDragOver && dragFromIndex !== null && dragFromIndex < i}
              <div class="h-0.5 rounded bg-primary/60 mx-1"></div>
            {/if}

            <!-- Edit panel (inline) -->
            {#if isEditing}
              <div class="pl-0 space-y-2 rounded-lg bg-surface p-2.5">
                <!-- Label -->
                <input
                  class="w-full text-xs bg-surface-lighter px-2 py-1.5 rounded border border-primary/30 outline-none text-text placeholder:text-text-muted"
                  placeholder="名前"
                  bind:value={editingLabel}
                  onkeydown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
                />
                <!-- A/B fine tune: ABRepeat と同スタイル -->
                <div class="flex items-center gap-2">
                  <!-- A点 -->
                  <div class="flex-1 flex items-center gap-1 px-2 py-1.5 rounded-lg bg-success/20 text-success border border-success/30">
                    <span class="font-bold text-sm">A</span>
                    <span class="flex-1 text-center text-xs font-mono">{formatTimeDec(editingA)}</span>
                    <div class="flex flex-col gap-0.5">
                      <button
                        class="w-5 h-4 flex items-center justify-center rounded text-[10px] bg-success/10 hover:bg-success/30 text-success transition-colors"
                        onclick={() => { editingA = clampA(editingA + 0.1, ps.duration); }}
                      >▲</button>
                      <button
                        class="w-5 h-4 flex items-center justify-center rounded text-[10px] bg-success/10 hover:bg-success/30 text-success transition-colors"
                        onclick={() => { editingA = clampA(editingA - 0.1, ps.duration); }}
                      >▼</button>
                    </div>
                  </div>
                  <!-- Arrow -->
                  <svg class="w-4 h-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                  </svg>
                  <!-- B点 -->
                  <div class="flex-1 flex items-center gap-1 px-2 py-1.5 rounded-lg bg-danger/20 text-danger border border-danger/30">
                    <span class="font-bold text-sm">B</span>
                    <span class="flex-1 text-center text-xs font-mono">{formatTimeDec(editingB)}</span>
                    <div class="flex flex-col gap-0.5">
                      <button
                        class="w-5 h-4 flex items-center justify-center rounded text-[10px] bg-danger/10 hover:bg-danger/30 text-danger transition-colors"
                        onclick={() => { editingB = clampB(editingB + 0.1, ps.duration); }}
                      >▲</button>
                      <button
                        class="w-5 h-4 flex items-center justify-center rounded text-[10px] bg-danger/10 hover:bg-danger/30 text-danger transition-colors"
                        onclick={() => { editingB = clampB(editingB - 0.1, ps.duration); }}
                      >▼</button>
                    </div>
                  </div>
                </div>
                <button
                  class="w-full px-2 py-1.5 text-xs rounded bg-primary text-white hover:bg-primary/90 transition-colors"
                  onclick={() => handleUpdate(bm.id)}
                >保存</button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
