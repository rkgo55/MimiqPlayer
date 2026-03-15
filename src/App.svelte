<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { trackStore } from './lib/stores/trackStore';
  import { playerStore, isAnyProcessingActive } from './lib/stores/playerStore';
  import { stemStore } from './lib/stores/stemStore';
  import Settings from './lib/components/Settings.svelte';
  import FileUpload from './lib/components/FileUpload.svelte';
  import TrackList from './lib/components/TrackList.svelte';
  import Player from './lib/components/Player.svelte';
  import { getStaleProcessingStates, deleteProcessingState, getProcessingState } from './lib/storage/db';

  import { settingsStore } from './lib/stores/settingsStore';

  let showTrackList = $state(true);

  onMount(async () => {
    await trackStore.load();

    // Restore the previously selected track from the URL hash
    const hash = window.location.hash.slice(1); // strip leading '#'
    if (hash) {
      const tracks = get(trackStore);
      const match = tracks.find((t) => t.id === hash);
      if (match) {
        trackStore.select(match.id);
        await playerStore.loadTrack(match.id);

        // Resume interrupted API operations on reload.
        // No time-limit check — the server cache means re-firing is safe and instant on hit.
        const apiSettings = get(settingsStore);
        if (apiSettings.apiEndpoint) {
          const [analyzePS, structurePS] = await Promise.all([
            getProcessingState(`${match.id}:analyze`),
            getProcessingState(`${match.id}:structure`),
          ]);
          if (analyzePS) void playerStore.analyzeTrack();
          if (structurePS) void playerStore.autoBookmarks();
        }
      }
    }

    // Silently clean up stale processing entries from other tracks
    const stale = await getStaleProcessingStates(30 * 60 * 1000);
    for (const s of stale) {
      await deleteProcessingState(s.id);
    }

    // beforeunload: warn user if AI processing is active
    window.addEventListener('beforeunload', (e) => {
      const stemProcessing = get(stemStore).status === 'processing';
      if (isAnyProcessingActive() || stemProcessing) {
        e.preventDefault();
      }
    });
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
      <!-- Mobile: toggle track list drawer -->
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
  <div class="flex-1 flex md:flex-row overflow-hidden relative">

    <!-- Mobile overlay backdrop -->
    {#if showTrackList}
      <div
        class="md:hidden fixed inset-0 z-40 bg-black/50"
        role="presentation"
        onclick={() => (showTrackList = false)}
      ></div>
    {/if}

    <!-- Sidebar / Track Panel -->
    <aside
      class="
        fixed top-0 left-0 h-full w-72 z-50 bg-surface border-r border-surface-lighter
        overflow-y-auto transition-transform duration-300 p-3
        md:relative md:translate-x-0 md:z-auto md:flex-shrink-0 md:p-4
        {showTrackList ? 'translate-x-0' : '-translate-x-full'}
      "
    >
      <!-- Mobile: close button -->
      <div class="md:hidden flex items-center justify-between mb-3">
        <span class="text-sm font-medium text-text-muted">曲一覧</span>
        <button
          class="p-1.5 rounded-lg hover:bg-surface-lighter transition-colors text-text-muted hover:text-text"
          onclick={() => (showTrackList = false)}
          aria-label="閉じる"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="flex flex-col gap-3">
        <FileUpload />
        <TrackList />
      </div>
    </aside>

    <!-- Player Area -->
    <main class="flex-1 p-3 md:p-6 overflow-y-auto w-full">
      <Player />
    </main>
  </div>
</div>
