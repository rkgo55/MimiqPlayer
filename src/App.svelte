<script lang="ts">
  import { onMount } from 'svelte';
  import { trackStore } from './lib/stores/trackStore';
  import FileUpload from './lib/components/FileUpload.svelte';
  import TrackList from './lib/components/TrackList.svelte';
  import Player from './lib/components/Player.svelte';
  import Settings from './lib/components/Settings.svelte';
  import { warmupAudioAnalysisWorker } from './lib/audio/AudioAnalysisWorkerClient.js';

  let showTrackList = $state(true);

  onMount(() => {
    trackStore.load();
    // Pre-load worker + Essentia WASM so analysis is ready when a track is selected
    warmupAudioAnalysisWorker();
  });

  // Auto-hide track list when a track is selected (mobile)
  trackStore.selectedId.subscribe((id) => {
    if (id && window.innerWidth < 768) {
      showTrackList = false;
    }
  });
</script>

<div class="h-full flex flex-col">
  <!-- Header -->
  <header class="flex items-center justify-between px-3 py-2 md:px-4 md:py-3 border-b border-surface-lighter flex-shrink-0">
    <div class="flex items-center gap-2">
      <img class="w-5 h-5 md:w-6 md:h-6" src="./logo_favicon.png" alt="MimiqPlayer Logo" />
      <h1 class="text-base md:text-lg font-bold">MimiqPlayer</h1>
    </div>
    <div class="flex items-center gap-1">
      <!-- Mobile: toggle track list -->
      <button
        class="md:hidden p-2 rounded-lg hover:bg-surface-lighter transition-colors text-text-muted hover:text-text"
        onclick={() => (showTrackList = !showTrackList)}
        title="曲一覧"
      >
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
        </svg>
      </button>
      <Settings />
    </div>
  </header>

  <!-- Main Content -->
  <div class="flex-1 flex flex-col md:flex-row overflow-hidden">
    <!-- Sidebar / Track Panel -->
    <aside
      class="border-b md:border-b-0 md:border-r border-surface-lighter md:w-72 flex-shrink-0 overflow-y-auto transition-all
        {showTrackList ? 'max-h-[40vh] md:max-h-none p-3 md:p-4' : 'max-h-0 md:max-h-none md:p-4 overflow-hidden md:overflow-y-auto p-0'}"
    >
      <div class="flex flex-col gap-3">
        <FileUpload />
        <TrackList />
      </div>
    </aside>

    <!-- Player Area -->
    <main class="flex-1 p-3 md:p-6 overflow-y-auto">
      <Player />
    </main>
  </div>
</div>
