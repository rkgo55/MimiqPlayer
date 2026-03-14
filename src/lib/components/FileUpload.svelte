<script lang="ts">
  import { trackStore } from '../stores/trackStore';
  import { playerStore } from '../stores/playerStore';
  import { importTrackFromZip } from '../storage/trackImport';
  import { isVideoFile, videoToAudio } from '../audio/videoToAudio';

  let isDragOver = $state(false);
  let isUploading = $state(false);
  let uploadStatus = $state('読み込み中...');
  let importError = $state<string | null>(null);
  let fileInput: HTMLInputElement;
  const MAX_FILE_BYTES = 250 * 1024 * 1024; // 250MB

  function isMimiqZip(file: File): boolean {
    return (
      file.name.endsWith('.mimiqtrack.zip') ||
      file.name.endsWith('.zip') ||
      file.type === 'application/zip' ||
      file.type === 'application/x-zip-compressed'
    );
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    isUploading = true;
    importError = null;

    try {
      for (const file of files) {
        // ── .mimiqtrack.zip import ────────────────────────────────────────
        if (isMimiqZip(file)) {
          await importTrackFromZip(file);
          await trackStore.load();
          continue;
        }

        // ── Video file → convert to audio ─────────────────────────────────
        if (isVideoFile(file)) {
          uploadStatus = `音声変換中... (${file.name})`;
          const audioFile = await videoToAudio(file);
          uploadStatus = '読み込み中...';
          const meta = await trackStore.addFile(audioFile);
          const tracks = await import('../storage/db').then((m) => m.getAllTracks());
          if (tracks.length === 1) {
            trackStore.select(meta.id);
            await playerStore.loadTrack(meta.id);
          }
          continue;
        }

        // ── Regular audio file ────────────────────────────────────────────
        if (!file.type.startsWith('audio/')) {
          console.warn(`${file.name} は音声ファイルではありません`);
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          console.warn(`${file.name} はサイズ上限(250MB)を超えています`);
          continue;
        }
        const meta = await trackStore.addFile(file);

        // Auto-select first uploaded track
        const tracks = await import('../storage/db').then((m) => m.getAllTracks());
        if (tracks.length === 1) {
          trackStore.select(meta.id);
          await playerStore.loadTrack(meta.id);
        }
      }
    } catch (e) {
      console.error('Import error:', e);
      importError = e instanceof Error ? e.message : 'インポートに失敗しました';
      setTimeout(() => (importError = null), 5000);
    } finally {
      isUploading = false;
      uploadStatus = '読み込み中...';
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;
    handleFiles(e.dataTransfer?.files ?? null);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    isDragOver = true;
  }

  function onDragLeave() {
    isDragOver = false;
  }

  function onClick() {
    fileInput?.click();
  }

  function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    handleFiles(input.files);
    input.value = '';
  }
</script>

<div
  class="border-2 border-dashed rounded-xl p-4 md:p-6 text-center cursor-pointer transition-all
    {isDragOver ? 'border-primary bg-primary/10' : 'border-surface-lighter hover:border-primary/50 active:border-primary/50'}"
  role="button"
  tabindex="0"
  ondrop={onDrop}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  onclick={onClick}
  onkeydown={(e) => e.key === 'Enter' && onClick()}
>
  <input
    bind:this={fileInput}
    type="file"
    accept="audio/*,video/*,.zip,application/zip"
    multiple
    class="hidden"
    onchange={onFileChange}
  />

  {#if isUploading}
    <div class="flex items-center justify-center gap-2 text-primary">
      <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25" />
        <path fill="currentColor" class="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span class="text-sm">{uploadStatus}</span>
    </div>
  {:else if importError}
    <div class="text-xs text-danger text-center">{importError}</div>
  {:else}
    <div class="text-text-muted">
      <svg class="mx-auto h-6 w-6 md:h-8 md:w-8 mb-1 md:mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
      </svg>
      <p class="text-sm">ファイルをドラッグ&ドロップ</p>
      <p class="text-xs mt-1">またはタップして選択</p>
    </div>
  {/if}
</div>
