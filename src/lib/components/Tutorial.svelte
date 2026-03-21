<script lang="ts">
  import { importTrackFromZip } from '../storage/trackImport';
  import { trackStore } from '../stores/trackStore';
  import { playerStore } from '../stores/playerStore';
  import { showTrackListStore, tutorialStore } from '../stores/uiStore';
  import { BETA_FREE_ACCESS } from '../betaConfig';

  const STORAGE_KEY = 'mimiqplayer_tutorial_done_v2';
  const SAMPLE_KEY = 'mimiqplayer_sample_imported';

  let visible = $state(false);
  let page = $state(0);
  let importing = $state(false);

  // Show only on first visit
  if (typeof localStorage !== 'undefined' && !localStorage.getItem(STORAGE_KEY)) {
    visible = true;
  }

  // Allow re-triggering from Settings
  tutorialStore.subscribe((show) => {
    if (show) { visible = true; page = 0; }
  });

  async function next() {
    if (page < 2) {
      page++;
    } else {
      await close();
    }
  }

  async function close() {
    tutorialStore.set(false);
    localStorage.setItem(STORAGE_KEY, '1');

    // 初回のみサンプルトラックをインポート（チュートリアルとは独立したフラグ）
    if (!localStorage.getItem(SAMPLE_KEY)) {
      localStorage.setItem(SAMPLE_KEY, '1');
      importing = true;
      try {
        const res = await fetch('./_Vespa.mimiqtrack.zip');
        if (res.ok) {
          const blob = await res.blob();
          const file = new File([blob], '_Vespa.mimiqtrack.zip', { type: 'application/zip' });
          const track = await importTrackFromZip(file);
          await trackStore.load();
          trackStore.select(track.id);
          await playerStore.loadTrack(track.id);
          showTrackListStore.set(true);
        }
      } catch {
        // サンプルインポート失敗は無視（通常の利用に影響させない）
      } finally {
        importing = false;
      }
    }

    visible = false;
  }

  const pages = [
    {
      icon: '🎵',
      title: 'MimiqPlayer へようこそ',
      body: '耳コピ・練習に特化した音楽プレイヤーです。音声や動画ファイルも直接読み込めます。',
      note: 'Chrome・Safari で動作します',
    },
    {
      icon: '🤖',
      title: 'AI 機能を使うには',
      body: BETA_FREE_ACCESS
        ? 'β版として公開中です。AI 機能を気軽にお試しください。使ってみた感想を下記リンクからぜひ教えてください！'
        : 'AI 機能を使いたい場合は、APIキーが必要です。下記のリンクからお気軽にご連絡ください。',
    },
    {
      icon: '🔗',
      title: '友達とシェアしよう',
      body: 'トラックをエクスポートし、.mimiqtrack.zip ファイルで友達と共有できます。',
    },
  ];
</script>

{#if visible}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    role="dialog"
    aria-modal="true"
    aria-label="チュートリアル"
  >
    <!-- Panel -->
    <div class="bg-surface rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-5">

      <!-- Progress dots -->
      <div class="flex items-center justify-center gap-1.5">
        {#each pages as _, i}
          <span
            class="w-2 h-2 rounded-full transition-colors {i === page ? 'bg-primary' : 'bg-surface-lighter'}"
          ></span>
        {/each}
      </div>

      <!-- Content -->
      <div class="text-center space-y-3">
        <div class="text-4xl">{pages[page].icon}</div>
        <h2 class="text-base font-bold text-text">{pages[page].title}</h2>
        <p class="text-sm text-text-muted leading-relaxed">{pages[page].body}</p>

        {#if page === 0}
          <p class="text-xs text-text-muted/70 bg-surface-light rounded-lg px-3 py-2">
            {pages[0].note}
          </p>
        {/if}

        {#if page === 1}
          <!-- Instagram (primary) -->
          <a
            href="https://www.instagram.com/rkgoo55/"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium transition-colors bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-pink-400 hover:from-purple-500/30 hover:to-pink-500/30"
          >
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
            </svg>
            Instagramで連絡する
          </a>
          <!-- Discord (secondary) -->
          <a
            href="https://discord.com/invite/BNUU9WVqpp"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs font-medium transition-colors text-text-muted/60 hover:text-text-muted"
          >
            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.08.114 18.102.134 18.115a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
            Discord
          </a>
        {/if}
      </div>

      <!-- Actions -->
      {#if importing}
        <div class="flex flex-col items-center gap-2 py-1">
          <svg class="w-6 h-6 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <p class="text-xs text-text-muted">サンプル曲を読み込み中…</p>
        </div>
      {:else}
        <div class="flex gap-2">
          <button
            class="flex-1 py-2.5 text-sm rounded-xl bg-primary text-white hover:bg-primary/90 transition-colors font-medium"
            onclick={next}
          >
            {page < 2 ? '次へ' : 'はじめる'}
          </button>
        </div>
      {/if}

    </div>
  </div>
{/if}
