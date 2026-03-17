<script lang="ts">
  import { playerStore, analyzingStructureTrackId as analyzingStructureTrackIdStore, activeSectionId, activeBookmarkId, AI_DURATION_LIMIT_ERROR } from '../stores/playerStore';
  import { settingsStore } from '../stores/settingsStore';
  import { apiKeyModalStore } from '../stores/uiStore';
  import { stemStore, type StemState } from '../stores/stemStore';
  import { get } from 'svelte/store';
  import type { PlayerState, SectionPoint } from '../types';
  import { confirmPaused } from '../utils/confirmPaused';

  let ps: PlayerState = $state({
    trackId: null, isPlaying: false, currentTime: 0, duration: 0,
    speed: 1, pitch: 0, volume: 1,
    abRepeat: { enabled: false, a: null, b: null },
  });
  let sectionPoints: SectionPoint[] = $state([]);
  let sectionLabels: Record<string, string> = $state({});
  let analyzingTrackId = $state<string | null>(null);
  let autoDetectError = $state<string | null>(null);
  let stemNotReady = $state(false);
  /** ID of the section being renamed: sections 1-N use sp.id, section 0 uses 'start' */
  let editingId = $state<string | null>(null);
  let editingLabel = $state('');
  let activeSectionIdValue: string | null = $state(null);
  let activeBookmarkIdValue: string | null = $state(null);
  activeSectionId.subscribe((v) => (activeSectionIdValue = v));
  activeBookmarkId.subscribe((v) => (activeBookmarkIdValue = v));

  // Auto-select the section containing the current playhead when sections first become available
  // Skip auto-select if a bookmark is already active (bookmark takes priority)
  $effect(() => {
    if (sections.length > 1 && activeSectionIdValue === null && activeBookmarkIdValue === null) {
      playerStore.loadSectionAtTime(ps.currentTime, false);
    }
  });

  let stemState: StemState = $state({
    status: 'none',
    volumes: { vocals: 1, drums: 1, bass: 1, other: 1, guitar: 1, piano: 1 },
    downloadProgress: null,
    message: '',
    remainingSeconds: null,
    loadedStems: null,
    backend: null,
  });

  playerStore.subscribe((v) => (ps = v));
  playerStore.sectionPoints.subscribe((v) => (sectionPoints = v));
  playerStore.sectionLabels.subscribe((v) => (sectionLabels = v));
  analyzingStructureTrackIdStore.subscribe((v) => (analyzingTrackId = v));
  stemStore.subscribe((v) => (stemState = v));

  const isAnalyzing = $derived(analyzingTrackId !== null && analyzingTrackId === ps.trackId);

  /** Sections derived from section points */
  const sections = $derived.by(() => {
    const sorted = [...sectionPoints].sort((a, b) => a.time - b.time);
    const dur = ps.duration;
    const result: { id: string; a: number; b: number }[] = [];
    let prev = 0;
    let prevId = 'start';
    for (const sp of sorted) {
      result.push({ id: prevId, a: prev, b: sp.time });
      prev = sp.time;
      prevId = sp.id;
    }
    result.push({ id: prevId, a: prev, b: dur });
    return result;
  });

  const activeSectionIndex = $derived(
    activeSectionIdValue !== null ? sections.findIndex((s) => s.id === activeSectionIdValue) : -1,
  );

  function goToSection(index: number) {
    if (index < 0 || index >= sections.length) return;
    playerStore.loadSectionAtTime(sections[index].a + 0.001);
  }

  function formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  async function handleAutoDetect() {
    if (isAnalyzing || !ps.trackId) return;
    // CAMPAIGN: 一時的にコメントアウト
    // if (!get(settingsStore).apiKey) {
    //   apiKeyModalStore.set(true);
    //   return;
    // }
    if (stemState.status !== 'ready') {
      stemNotReady = true;
      return;
    }
    stemNotReady = false;
    if (sectionPoints.length > 0) {
      if (!confirmPaused('既存のセクションは上書きされます。続けますか？')) return;
    }
    autoDetectError = null;
    try {
      await playerStore.autoDetectSections();
    } catch (e) {
      if (e instanceof Error && e.message === AI_DURATION_LIMIT_ERROR) {
        autoDetectError = '10分を超える楽曲はAI解析に対応していません';
      }
    }
  }

  function startEdit(id: string, currentLabel?: string) {
    editingId = id;
    editingLabel = currentLabel ?? '';
  }

  function cancelEdit() {
    editingId = null;
    editingLabel = '';
  }

  async function handleSaveLabel(secId: string) {
    if (secId !== 'start') {
      await playerStore.updateSectionLabel(secId, editingLabel);
    }
    // Section 0 ('start') label is not persisted — close without saving
    editingId = null;
    editingLabel = '';
  }
</script>

<div class="space-y-2">
    <!-- Header: add at current position + auto-detect -->
    <div class="flex items-center gap-1.5 flex-wrap">
      <button
        class="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-surface-lighter text-text-muted hover:bg-surface-lighter/80 hover:text-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        onclick={() => playerStore.addSectionPoint()}
        disabled={!ps.trackId}
        title="現在位置にセクションを追加"
      >
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        再生位置で区切る
      </button>

      <button
        class="ml-auto flex-shrink-0 flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        onclick={handleAutoDetect}
        disabled={isAnalyzing}
        title="AIで楽曲構造を解析して自動でセクションを検出"
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
          楽曲構造を解析
        {/if}
      </button>
    </div>

    {#if stemNotReady}
      <p class="text-[11px] text-amber-400">楽曲構造を解析するにはステム分離が必要です。先にミキサーで「ステムを分離」を実行してください。</p>
    {/if}
    {#if isAnalyzing}
      <p class="text-[11px] text-text-muted opacity-70">数分かかる場合があります・処理中はアプリを閉じないでください</p>
    {/if}
    {#if autoDetectError}
      <p class="text-[11px] text-red-400">{autoDetectError}</p>
    {/if}

    <!-- Prev / Next navigation -->
    {#if sections.length > 1}
      <div class="flex items-center gap-1.5">
        <button
          class="flex items-center gap-1 px-2 py-1 text-xs rounded bg-surface-lighter text-text-muted hover:bg-surface-lighter/80 hover:text-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          onclick={() => goToSection(activeSectionIndex - 1)}
          disabled={activeSectionIndex <= 0}
          title="前のセクション"
        >
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          前へ
        </button>
        <span class="flex-1 text-center text-xs text-text-muted">
          {#if activeSectionIndex >= 0}
            {activeSectionIndex + 1} / {sections.length}
          {:else}
            — / {sections.length}
          {/if}
        </span>
        <button
          class="flex items-center gap-1 px-2 py-1 text-xs rounded bg-surface-lighter text-text-muted hover:bg-surface-lighter/80 hover:text-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          onclick={() => goToSection(activeSectionIndex + 1)}
          disabled={activeSectionIndex < 0 || activeSectionIndex >= sections.length - 1}
          title="次のセクション"
        >
          次へ
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>
    {/if}

    <!-- Section list -->
    {#if sections.length > 1 || sectionPoints.length > 0}
      <div class="space-y-1">
        {#each sections as sec, i (sec.id)}
          {@const isActive = ps.abRepeat.enabled && ps.abRepeat.a === sec.a && ps.abRepeat.b === sec.b}
          {@const isFirst = i === 0}
          {@const sp = isFirst ? null : sectionPoints.find((s) => s.id === sec.id)}
          {@const label = sectionLabels[sec.id]}
          <div class="space-y-1">
            <div class="flex items-center gap-1.5">
              <!-- Section button -->
              <button
                class="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors
                  {isActive ? 'bg-primary/20 text-primary' : 'bg-surface-lighter hover:bg-surface-lighter/80 text-text'}"
                onclick={() => playerStore.loadSectionAtTime(sec.a + 0.001)}
                title="クリックでこの区間をループ"
              >
                <span class="text-text-muted flex-shrink-0">{i + 1}</span>
                {#if label}
                  <span class="font-medium truncate">{label}</span>
                  <span class="font-mono text-text-muted/70 flex-shrink-0 ml-auto">{formatTime(sec.a)}–{formatTime(sec.b)}</span>
                {:else}
                  <span class="flex-1 font-mono">{formatTime(sec.a)} → {formatTime(sec.b)}</span>
                  <span class="text-text-muted/60 flex-shrink-0">{(sec.b - sec.a).toFixed(1)}s</span>
                {/if}
              </button>

              <!-- Edit (rename) button — all sections -->
              <button
                class="flex-shrink-0 p-1 rounded transition-all
                  {editingId === sec.id ? 'bg-primary/20 text-primary' : 'text-text-muted/50 hover:bg-surface-lighter hover:text-text'}"
                onclick={() => editingId === sec.id ? cancelEdit() : startEdit(sec.id, sectionLabels[sec.id])}
                title={editingId === sec.id ? '編集キャンセル' : 'セクション名を編集'}
              >
                {#if editingId === sec.id}
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                {:else}
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                  </svg>
                {/if}
              </button>

              <!-- Delete button — sections 2+ only; invisible placeholder for section 1 to keep alignment -->
              {#if !isFirst && sp}
                <button
                  class="flex-shrink-0 p-1 rounded hover:bg-danger/15 text-text-muted/50 hover:text-danger transition-all"
                  onclick={() => { if (confirmPaused('このセクションの区切りを削除しますか？')) playerStore.deleteSectionPoint(sp.id); }}
                  title="このセクションを削除"
                >
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m19 7-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
                  </svg>
                </button>
              {:else}
                <!-- placeholder to maintain column alignment -->
                <span class="flex-shrink-0 w-5"></span>
              {/if}
            </div>

            <!-- Rename panel -->
            {#if editingId === sec.id}
              <div class="ml-6 flex gap-1.5">
                <input
                  class="flex-1 text-xs bg-surface px-2 py-1.5 rounded border border-primary/40 outline-none text-text placeholder:text-text-muted"
                  placeholder="セクション名（例: Aメロ、サビ）"
                  bind:value={editingLabel}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') handleSaveLabel(sec.id);
                    if (e.key === 'Escape') cancelEdit();
                  }}
                />
                <button
                  class="px-3 py-1.5 text-xs rounded bg-primary text-white hover:bg-primary/90 transition-colors"
                  onclick={() => handleSaveLabel(sec.id)}
                >保存</button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {:else if !isAnalyzing}
      <p class="text-xs text-text-muted">「再生位置で区切る」で手動追加するか、AIで楽曲構造を解析して自動追加できます。</p>
    {/if}
  </div>
