<script lang="ts">
  import { playerStore } from '../stores/playerStore';
  import type { EQBands } from '../types';
  import { EQ_FLAT, EQ_PRESETS } from '../types';

  let eq: EQBands = $state([...EQ_FLAT]);
  playerStore.eq.subscribe((v) => (eq = [...v] as EQBands));

  const BANDS = [
    { freq: '32Hz',  label: '32' },
    { freq: '64Hz',  label: '64' },
    { freq: '125Hz', label: '125' },
    { freq: '250Hz', label: '250' },
    { freq: '500Hz', label: '500' },
    { freq: '1kHz',  label: '1k' },
    { freq: '2kHz',  label: '2k' },
    { freq: '4kHz',  label: '4k' },
    { freq: '8kHz',  label: '8k' },
    { freq: '16kHz', label: '16k' },
  ];

  const PRESETS = [
    { key: 'flat',   label: 'フラット' },
    { key: 'bass',   label: 'ベース' },
    { key: 'vocal',  label: 'ボーカル' },
    { key: 'treble', label: '高音' },
  ];

  function applyPreset(key: string) {
    playerStore.setEQ(EQ_PRESETS[key] as EQBands);
  }

  function setGain(index: number, value: number) {
    const next = [...eq] as EQBands;
    next[index] = value;
    playerStore.setEQ(next);
  }

  const isFlat = $derived(eq.every((g) => g === 0));
</script>

<div class="bg-surface-light rounded-lg p-3 space-y-3">
  <div class="flex items-center justify-between">
    <span class="text-xs text-text-muted font-medium">10バンドEQ</span>
    <div class="flex items-center gap-2">
      {#if !isFlat}
        <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary">変更中</span>
      {/if}
      <button
        class="text-[10px] px-2 py-1 rounded bg-surface-lighter text-text-muted hover:bg-surface-lighter/80 transition-colors"
        onclick={() => applyPreset('flat')}
      >
        リセット
      </button>
    </div>
  </div>

  <!-- Preset buttons -->
  <div class="flex gap-1.5">
    {#each PRESETS as preset}
      <button
        class="flex-1 py-1 text-xs rounded transition-colors
          {JSON.stringify([...eq]) === JSON.stringify([...EQ_PRESETS[preset.key]])
            ? 'bg-primary text-white'
            : 'bg-surface-lighter text-text-muted hover:bg-surface-lighter/80'}"
        onclick={() => applyPreset(preset.key)}
      >
        {preset.label}
      </button>
    {/each}
  </div>

  <!-- 10 Band Sliders -->
  <div class="flex items-end gap-1">
    {#each BANDS as band, i}
      <div class="flex-1 flex flex-col items-center gap-1">
        <!-- Vertical slider wrapper -->
        <div class="relative h-24 w-full flex items-center justify-center">
          <!-- Track background -->
          <div class="absolute inset-x-[45%] inset-y-0 rounded-full bg-surface-lighter"></div>
          <!-- Center marker line -->
          <div class="absolute inset-x-0 top-1/2 h-px bg-surface-lighter/60"></div>
          <!-- Fill bar: 0 → positive (upward, primary) -->
          {#if eq[i] > 0}
            <div
              class="absolute inset-x-[38%] rounded-full bg-primary transition-all"
              style="bottom: 50%; height: {(eq[i] / 12) * 50}%;"
            ></div>
          {/if}
          <!-- Fill bar: negative → 0 (downward, accent/orange) -->
          {#if eq[i] < 0}
            <div
              class="absolute inset-x-[38%] rounded-full bg-accent transition-all"
              style="top: 50%; height: {(-eq[i] / 12) * 50}%;"
            ></div>
          {/if}
          <!-- Invisible full-height range input on top -->
          <input
            type="range"
            min="-12"
            max="12"
            step="1"
            value={eq[i]}
            oninput={(e) => setGain(i, Number((e.target as HTMLInputElement).value))}
            class="absolute appearance-none bg-transparent cursor-pointer z-10 opacity-0"
            style="writing-mode: vertical-lr; direction: rtl; width: 100%; height: 100%;"
          />
          <!-- Thumb indicator (visible dot at slider position) -->
          <div
            class="absolute w-3 h-3 rounded-full border-2 pointer-events-none transition-all z-20
              {eq[i] > 0 ? 'bg-primary border-primary' : eq[i] < 0 ? 'bg-accent border-accent' : 'bg-surface border-text-muted'}"
            style="top: {(1 - (eq[i] + 12) / 24) * 100}%; transform: translateY(-50%);"
          ></div>
        </div>
        <!-- dB value -->
        <span class="text-[9px] font-mono {eq[i] !== 0 ? 'text-primary' : 'text-text-muted'}">
          {eq[i] > 0 ? '+' : ''}{eq[i]}
        </span>
        <!-- Freq label -->
        <span class="text-[9px] text-text-muted">{band.label}</span>
      </div>
    {/each}
  </div>

  <!-- Range labels -->
  <div class="flex justify-between text-[9px] text-text-muted">
    <span>-12dB</span>
    <span>0</span>
    <span>+12dB</span>
  </div>
</div>
