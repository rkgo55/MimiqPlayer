<script lang="ts">
  import { trackStore } from '../stores/trackStore';
  import { settingsStore } from '../stores/settingsStore';
  import { STEM_MODEL_OPTIONS } from '../types';
  import type { AppSettings } from '../types';
  import { getStorageEstimate, deleteAllTracks } from '../storage/db';

  let isOpen = $state(false);
  let storage = $state({ usedMB: 0, quotaMB: 0, ratio: 0 });
  let settings: AppSettings = $state({ skipDuration: 5, defaultSpeed: 1, defaultPitch: 0, stemModel: 'htdemucs-4s', keepAwake: false, apiEndpoint: '', apiKey: '' });
  const baseUrl = import.meta.env.BASE_URL;
  const builtInEndpoint = import.meta.env.VITE_API_ENDPOINT ?? '';
  const builtInApiKey = import.meta.env.VITE_API_KEY ?? '';
  settingsStore.subscribe((v) => (settings = v));

  async function openSettings() {
    isOpen = true;
    storage = await getStorageEstimate();
  }

  async function handleDeleteAll() {
    if (!confirm('すべてのトラックとデータを削除しますか？\nこの操作は取り消せません。')) return;
    await deleteAllTracks();
    trackStore.select(null);
    await trackStore.load();
    storage = await getStorageEstimate();
    isOpen = false;
  }

  function formatMB(mb: number): string {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${mb.toFixed(0)} MB`;
  }
</script>

<div class="relative">
  <button
    class="p-2 rounded-lg hover:bg-surface-lighter transition-colors text-text-muted hover:text-text"
    onclick={openSettings}
    title="設定"
  >
    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  </button>

  {#if isOpen}
    <!-- Backdrop -->
    <button
      class="fixed inset-0 z-40"
      onclick={() => (isOpen = false)}
      aria-label="閉じる"
    ></button>

    <!-- Dropdown -->
    <div class="absolute right-0 top-full mt-2 w-72 bg-surface-light border border-surface-lighter rounded-xl shadow-xl z-50 p-4 space-y-4">
      <h3 class="text-sm font-medium">設定</h3>

      <!-- Storage usage -->
      <div>
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs text-text-muted">ストレージ使用量</span>
          {#if storage.quotaMB > 0}
            <span class="text-[10px] text-text-muted font-mono">
              {formatMB(storage.usedMB)} / {formatMB(storage.quotaMB)}
            </span>
          {/if}
        </div>
        {#if storage.quotaMB > 0}
          <!-- Usage bar -->
          <div class="w-full h-1.5 bg-surface-lighter rounded-full overflow-hidden mb-1">
            <div
              class="h-full rounded-full transition-all
                {storage.ratio > 0.8 ? 'bg-danger' : storage.ratio > 0.5 ? 'bg-accent' : 'bg-primary'}"
              style="width: {Math.min(100, storage.ratio * 100).toFixed(1)}%"
            ></div>
          </div>
          {#if storage.ratio > 0.8}
            <p class="text-[10px] text-danger">⚠ ストレージが残り少なくなっています</p>
          {/if}
        {:else}
          <p class="text-[10px] text-text-muted">ブラウザが見積もりをサポートしていません</p>
        {/if}
      </div>

      <!-- AI Model selection -->
      <div>
        <span class="text-xs text-text-muted block mb-1.5">ステム分離モデル</span>
        <div class="space-y-1">
          {#each STEM_MODEL_OPTIONS as opt}
            <label class="flex items-start gap-2 cursor-pointer group">
              <input
                type="radio"
                name="stemModel"
                value={opt.id}
                checked={settings.stemModel === opt.id}
                onchange={() => settingsStore.update((s) => ({ ...s, stemModel: opt.id }))}
                class="mt-0.5 accent-primary"
              />
              <div>
                <span class="text-xs text-text group-hover:text-text">{opt.label}</span>
                <p class="text-[10px] text-text-muted leading-tight">{opt.description}</p>
              </div>
            </label>
          {/each}
        </div>
      </div>

      <!-- API settings -->
      <div>
        <span class="text-xs text-text-muted block mb-1.5">外部 API (Modal)</span>
        <div class="space-y-1.5">
          <div>
            <label for="apiKey-input" class="text-[10px] text-text-muted block mb-0.5">
              API Key（オプション）
              {#if builtInApiKey}
                <span class="ml-1 text-primary/70">(ビルド時設定済み)</span>
              {/if}
            </label>
            <input
              id="apiKey-input"
              type="password"
              placeholder={builtInApiKey ? '••••••••' : 'Token'}
              value={settings.apiKey}
              oninput={(e) => settingsStore.update((s) => ({ ...s, apiKey: (e.target as HTMLInputElement).value.trim() }))}
              class="w-full text-[11px] bg-surface border border-surface-lighter rounded px-2 py-1 text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary"
            />
          </div>
          {#if settings.apiEndpoint}
            <p class="text-[10px] text-primary">✓ API 設定済み — トラック解析・ステム分離に使用されます</p>
          {:else}
            <p class="text-[10px] text-text-muted">未設定の場合はブラウザ内 AI を使用します</p>
          {/if}
        </div>
      </div>

      <!-- Delete all -->
      <div>
        <button
          class="w-full py-1.5 px-3 text-xs rounded-lg bg-danger/10 text-danger hover:bg-danger/20 transition-colors"
          onclick={handleDeleteAll}
        >
          すべてのトラックを削除
        </button>
      </div>

      <!-- License info -->
      <div>
        <div class="text-[11px] text-text-muted space-y-1">
          <a
            class="block hover:text-text underline underline-offset-2"
            href={`${baseUrl}licenses.html`}
            target="_blank"
            rel="noopener noreferrer"
          >
            OSSライセンス一覧を開く
          </a>
        </div>
      </div>
    </div>
  {/if}
</div>
