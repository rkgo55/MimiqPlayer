<script lang="ts">
  import { playerStore } from '../stores/playerStore';
  import type { PlayerState, LoopBookmark } from '../types';

  let ps: PlayerState = $state({
    trackId: null, isPlaying: false, currentTime: 0, duration: 0,
    speed: 1, pitch: 0, volume: 1,
    abRepeat: { enabled: false, a: null, b: null },
  });
  let bookmarks: LoopBookmark[] = $state([]);
  let savingLabel = $state('');
  let isAdding = $state(false);
  /** ID of the bookmark currently being edited, or null */
  let editingId = $state<string | null>(null);
  let editingLabel = $state('');

  playerStore.subscribe((v) => (ps = v));
  playerStore.bookmarks.subscribe((v) => (bookmarks = v));

  function formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
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
  }

  function cancelEdit() {
    editingId = null;
    editingLabel = '';
  }

  async function handleUpdate(id: string, useCurrentAB: boolean) {
    await playerStore.updateBookmark(id, editingLabel, useCurrentAB);
    cancelEdit();
  }
</script>

{#if bookmarks.length > 0 || canSave}
  <div class="bg-surface-light rounded-lg p-3 space-y-2">
    <div class="flex items-center justify-between">
      <span class="text-xs text-text-muted font-medium">ループブックマーク</span>
      {#if canSave && !isAdding && editingId === null}
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
      <div class="space-y-1">
        {#each bookmarks as bm (bm.id)}
          {@const isActive = ps.abRepeat.a === bm.a && ps.abRepeat.b === bm.b}
          {@const isEditing = editingId === bm.id}
          <div class="space-y-1">
            <div class="flex items-center gap-2">
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

            <!-- Edit panel (inline) -->
            {#if isEditing}
              <div class="pl-0 space-y-1.5 rounded-lg bg-surface p-2.5">
                <input
                  class="w-full text-xs bg-surface-lighter px-2 py-1.5 rounded border border-primary/30 outline-none text-text placeholder:text-text-muted"
                  placeholder="名前"
                  bind:value={editingLabel}
                  onkeydown={(e) => {
                    if (e.key === 'Escape') cancelEdit();
                  }}
                />
                {#if canSave}
                  <button
                    class="w-full px-2 py-1.5 text-xs rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
                    onclick={() => handleUpdate(bm.id, true)}
                    title="現在の A-B と名前で上書き"
                  >現在のA-Bで上書き保存</button>
                {:else}
                  <button
                    class="w-full px-2 py-1.5 text-xs rounded bg-surface-lighter text-text-muted hover:bg-surface-lighter/80 transition-colors"
                    onclick={() => handleUpdate(bm.id, false)}
                  >名前を変更</button>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
