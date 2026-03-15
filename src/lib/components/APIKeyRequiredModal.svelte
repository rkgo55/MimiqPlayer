<script lang="ts">
  import { apiKeyModalStore } from '../stores/uiStore';

  function close() {
    apiKeyModalStore.set(false);
  }
</script>

<!-- Backdrop -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onkeydown={(e) => { if (e.key === 'Escape') close(); }}
>
  <!-- Panel -->
  <div class="bg-surface rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">

    <!-- Header -->
    <div class="flex items-start gap-3">
      <div class="flex-shrink-0 w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center">
        <svg class="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 0 1 21.75 8.25Z" />
        </svg>
      </div>
      <div>
        <h2 class="text-sm font-bold text-text">APIキーが設定されていません</h2>
        <p class="text-xs text-text-muted mt-1">AI機能を使うにはAPIキーが必要です</p>
      </div>
    </div>

    <!-- Message -->
    <div class="bg-surface-light rounded-xl p-4 space-y-2 text-sm text-text-muted">
      <p>管理人 <span class="text-text font-medium">okago</span> に連絡してAPIキーを発行してもらってください。</p>
      <p class="text-xs">APIキーを取得したら、設定画面から入力できます。</p>
    </div>

    <!-- Instagram link -->
    <a
      href="https://www.instagram.com/rkgoo55/"
      target="_blank"
      rel="noopener noreferrer"
      class="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium transition-colors bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-pink-400 hover:from-purple-500/30 hover:to-pink-500/30"
    >
      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
      </svg>
      @rkgoo55 に連絡する
    </a>

    <!-- Close -->
    <button
      class="w-full py-2 text-sm text-text-muted hover:text-text transition-colors"
      onclick={close}
    >
      閉じる
    </button>
  </div>
</div>
