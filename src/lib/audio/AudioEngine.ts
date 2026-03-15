import { SoundTouchNode } from '@soundtouchjs/audio-worklet';
import processorUrl from '@soundtouchjs/audio-worklet/processor?url';
import type { EQBands, StemType, StemVolumes } from '../types';
import { EQ_FLAT, DEFAULT_STEM_VOLUMES } from '../types';

export type AudioEngineCallback = (currentTime: number, duration: number) => void;

/** Center frequencies for the 10 EQ bands */
const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/**
 * Core audio engine using Web Audio API + SoundTouchJS
 * Provides independent pitch and speed control
 */
export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private soundTouchNode: SoundTouchNode | null = null;
  private gainNode: GainNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private analyserNode: AnalyserNode | null = null;
  private workletRegistered = false;

  // ─── Stem audio ────────────────────────────────────────────────────────────
  private _stemBuffers = new Map<StemType, AudioBuffer>();
  private _stemSources: AudioBufferSourceNode[] = [];
  private _stemGains = new Map<StemType, GainNode>();
  private _stemVolumes: StemVolumes = { ...DEFAULT_STEM_VOLUMES };

  private _isPlaying = false;
  private _duration = 0;
  private _speed = 1.0;
  private _pitch = 0; // semitones
  private _volume = 1.0;
  private _eq: EQBands = [...EQ_FLAT];
  private _savedTime = 0; // saved position for pause/resume
  private playbackStartedAt = 0;
  private playbackStartedOffset = 0;

  private animFrameId: number | null = null;
  private onTimeUpdate: AudioEngineCallback | null = null;
  private onEnded: (() => void) | null = null;

  get isPlaying(): boolean {
    return this._isPlaying;
  }
  get duration(): number {
    return this._duration;
  }
  get currentTime(): number {
    if (this._isPlaying && this.audioContext) {
      const elapsed = (this.audioContext.currentTime - this.playbackStartedAt) * this._speed;
      return Math.max(0, Math.min(this._duration, this.playbackStartedOffset + elapsed));
    }
    return this._savedTime;
  }
  get speed(): number {
    return this._speed;
  }
  get pitch(): number {
    return this._pitch;
  }
  get volume(): number {
    return this._volume;
  }
  get eq(): EQBands {
    return this._eq;
  }
  get analyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  /** True when any stem AudioBuffers are loaded and ready (supports 4-stem and 6-stem) */
  get hasStemAudio(): boolean {
    return this._stemBuffers.size > 0;
  }

  /** Stem types currently loaded in the engine */
  get loadedStemTypes(): StemType[] {
    return Array.from(this._stemBuffers.keys());
  }

  /** Current per-stem volume map */
  get stemVolumes(): StemVolumes {
    return { ...this._stemVolumes };
  }

  private ensureContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    return this.audioContext;
  }

  /** Load audio from ArrayBuffer */
  async loadAudio(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.ensureContext();
    this.stop();
    // Clear stale stems when loading a new track
    this._stemBuffers.clear();

    // Decode the audio data
    this.audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    this._duration = this.audioBuffer.duration;
    this._savedTime = 0;
    return this.audioBuffer;
  }

  /** Get the loaded AudioBuffer */
  getAudioBuffer(): AudioBuffer | null {
    return this.audioBuffer;
  }

  /** Load pre-decoded stem AudioBuffers */
  loadStems(buffers: Partial<Record<StemType, AudioBuffer>>): void {
    this._stemBuffers.clear();
    for (const [stem, buf] of Object.entries(buffers) as [StemType, AudioBuffer | undefined][]) {
      if (buf) this._stemBuffers.set(stem, buf);
    }
  }

  /**
   * Decode WAV ArrayBuffers (as stored in IndexedDB) and load as stems.
   * Restarts playback in stem mode if currently playing.
   */
  async loadStemsFromArrayBuffers(
    wavBuffers: Partial<Record<StemType, ArrayBuffer>>,
  ): Promise<void> {
    const ctx = this.ensureContext();
    const entries = await Promise.all(
      (Object.keys(wavBuffers) as StemType[])
        .filter((s) => wavBuffers[s])
        .map(async (s) => [s, await ctx.decodeAudioData(wavBuffers[s]!.slice(0))] as const),
    );
    const decoded: Partial<Record<StemType, AudioBuffer>> = {};
    for (const [stem, buf] of entries) decoded[stem] = buf;

    const wasPlaying = this._isPlaying;
    const savedTime = this.currentTime;
    if (wasPlaying) this.pause();
    this.loadStems(decoded);
    this._savedTime = savedTime;
    if (wasPlaying) this.play();
  }

  /** Remove all loaded stems (revert to normal playback) */
  clearStems(): void {
    const wasPlaying = this._isPlaying;
    const savedTime = this.currentTime;
    if (wasPlaying) this.pause();
    this._stemBuffers.clear();
    this._savedTime = savedTime;
    if (wasPlaying) this.play();
  }

  /** Set the volume for a single stem (0–1). Persists across seek/restart. */
  setStemVolume(stem: StemType, volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    (this._stemVolumes as Record<string, number>)[stem] = clamped;
    const gainNode = this._stemGains.get(stem);
    if (gainNode) {
      gainNode.gain.value = clamped;
    }
  }

  /** Apply all stem volumes at once */
  setStemVolumes(volumes: StemVolumes): void {
    for (const [stem, vol] of Object.entries(volumes) as [StemType, number][]) {
      this.setStemVolume(stem, vol);
    }
  }

  /** Start or resume playback from saved position */
  play(): void {
    if (!this.audioBuffer || this._isPlaying) return;
    const ctx = this.ensureContext();
    const percentage = this._duration > 0 ? this._savedTime / this._duration : 0;
    void this._startPlayback(ctx, percentage);
  }

  /** Pause playback */
  pause(): void {
    if (!this._isPlaying) return;

    this._savedTime = this.currentTime;

    this._isPlaying = false;
    this._stopTimeTracking();
    this._teardownPlaybackGraph();
  }

  /** Stop playback and reset position */
  stop(): void {
    this._isPlaying = false;
    this._savedTime = 0;
    this._stopTimeTracking();
    this._teardownPlaybackGraph();
  }

  /** Seek to a specific time in seconds */
  seek(time: number): void {
    if (!this.audioBuffer || !this._duration) return;
    const clampedTime = Math.max(0, Math.min(time, this._duration));
    const wasPlaying = this._isPlaying;
    const percentage = clampedTime / this._duration;

    // Save the target time
    this._savedTime = clampedTime;

    // Tear down current playback
    this._isPlaying = false;
    this._stopTimeTracking();
    this._teardownPlaybackGraph();

    if (wasPlaying) {
      // Recreate pipeline at new position and resume
      const ctx = this.ensureContext();
      void this._startPlayback(ctx, percentage);
    } else {
      // Just update the saved time + notify listeners
      this.onTimeUpdate?.(clampedTime, this._duration);
    }
  }

  /** Set playback speed (0.25 - 2.0) */
  setSpeed(speed: number): void {
    this._speed = Math.max(0.25, Math.min(2.0, speed));
    if (this.audioContext) {
      if (this.hasStemAudio && this._stemSources.length > 0) {
        const current = this.currentTime;
        this.playbackStartedOffset = current;
        this.playbackStartedAt = this.audioContext.currentTime;
        for (const src of this._stemSources) {
          src.playbackRate.value = this._speed;
        }
        if (this.soundTouchNode) {
          this.soundTouchNode.playbackRate.value = this._speed;
        }
      } else if (this.sourceNode && this.soundTouchNode) {
        const current = this.currentTime;
        this.playbackStartedOffset = current;
        this.playbackStartedAt = this.audioContext.currentTime;
        this.sourceNode.playbackRate.value = this._speed;
        this.soundTouchNode.playbackRate.value = this._speed;
      }
    }
  }

  /** Set pitch shift in semitones (-12 to +12) */
  setPitch(semitones: number): void {
    this._pitch = Math.max(-12, Math.min(12, semitones));
    if (this.soundTouchNode) {
      this.soundTouchNode.pitchSemitones.value = this._pitch;
    }
  }

  /** Set volume (0 - 1) */
  setVolume(vol: number): void {
    this._volume = Math.max(0, Math.min(1, vol));
    if (this.gainNode) {
      this.gainNode.gain.value = this._volume;
    }
  }

  /** Apply 10-band EQ gains */
  setEQ(bands: EQBands): void {
    this._eq = [...bands] as EQBands;
    for (let i = 0; i < this.eqFilters.length; i++) {
      this.eqFilters[i].gain.value = bands[i] ?? 0;
    }
  }

  /** Register time update callback */
  onProgress(cb: AudioEngineCallback): void {
    this.onTimeUpdate = cb;
  }

  /** Register playback ended callback */
  onPlaybackEnded(cb: () => void): void {
    this.onEnded = cb;
  }

  /** Get frequency data for visualization */
  getFrequencyData(): Uint8Array | null {
    if (!this.analyserNode) return null;
    const data = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(data);
    return data;
  }

  /** Cleanup resources */
  destroy(): void {
    this.stop();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.audioBuffer = null;
  }

  /**
   * Called when the app returns to foreground after being backgrounded.
   *
   * Mobile browsers (iOS Safari in particular) suspend the AudioContext when
   * the page is hidden. On resume two problems arise:
   *   1. The context stays suspended and audio is silent.
   *   2. SoundTouch's AudioWorklet ring-buffer accumulates stale data during
   *      the suspension gap, producing a burst of crackle/noise when playback
   *      resumes.
   *
   * This method:
   *   - Resumes the AudioContext if it is suspended.
   *   - For normal (SoundTouch) mode: re-seeks to the current position so
   *     the SoundTouch pipeline is torn down and rebuilt fresh, flushing
   *     the stale buffer.
   *   - For stem mode: just ensures the AudioContext is running and restarts
   *     the rAF time-tracking loop if it stopped.
   */
  async handleForeground(): Promise<void> {
    if (!this.audioContext) return;
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    if (!this._isPlaying) return;

    if (!this.hasStemAudio) {
      // Normal mode: rebuild the SoundTouch pipeline to flush stale buffers
      const time = this.currentTime;
      this._isPlaying = false;
      this._stopTimeTracking();
      this._teardownPlaybackGraph();
      this._savedTime = time;
      void this._startPlayback(
        this.audioContext,
        this._duration > 0 ? time / this._duration : 0,
      );
    } else {
      // Stem mode: rAF loop may have stopped while backgrounded; restart it
      if (this.animFrameId === null) {
        this._startTimeTracking();
      }
    }
  }

  private async _startPlayback(ctx: AudioContext, startPercentage = 0): Promise<void> {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    await this._setupPipeline(ctx, startPercentage);
    this._isPlaying = true;
    this._startTimeTracking();
  }

  private async _setupPipeline(ctx: AudioContext, startPercentage = 0): Promise<void> {
    this._teardownPlaybackGraph();

    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = this._volume;

    // 10-band EQ (peaking filters at each center frequency)
    this.eqFilters = EQ_FREQUENCIES.map((freq, i) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.4;
      filter.gain.value = this._eq[i] ?? 0;
      return filter;
    });

    // Chain EQ filters
    for (let i = 0; i < this.eqFilters.length - 1; i++) {
      this.eqFilters[i].connect(this.eqFilters[i + 1]);
    }

    this.analyserNode = ctx.createAnalyser();
    this.analyserNode.fftSize = 2048;

    // Shared tail: eqFilters[last] → analyser → destination
    this.eqFilters[this.eqFilters.length - 1].connect(this.analyserNode);
    this.analyserNode.connect(ctx.destination);

    // Register SoundTouch worklet once (needed in both modes for pitch)
    if (!this.workletRegistered) {
      await SoundTouchNode.register(ctx, processorUrl);
      this.workletRegistered = true;
    }

    const duration = this._duration > 0 ? this._duration : 0;
    const startOffset = Math.max(0, Math.min(duration, startPercentage * duration));
    this.playbackStartedOffset = startOffset;
    this.playbackStartedAt = ctx.currentTime;
    this._savedTime = startOffset;

    if (this.hasStemAudio) {
      // ── Stem mode: N sources → N individual gains → gainNode → soundTouch → eq ──
      this._stemGains.clear();
      this._stemSources = [];

      let firstSource: AudioBufferSourceNode | null = null;
      for (const [stem, buf] of this._stemBuffers) {
        if (!buf) continue;

        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = this._speed;

        const stemGain = ctx.createGain();
        stemGain.gain.value = (this._stemVolumes as Record<string, number>)[stem] ?? 1;

        src.connect(stemGain);
        stemGain.connect(this.gainNode!);

        this._stemGains.set(stem, stemGain);
        this._stemSources.push(src);

        if (!firstSource) {
          firstSource = src;
          src.onended = () => {
            if (!this._isPlaying) return;
            this._isPlaying = false;
            this._savedTime = 0;
            this._stopTimeTracking();
            this._teardownPlaybackGraph();
            this.onEnded?.();
          };
        }
        src.start(0, startOffset);
      }

      // Insert SoundTouch after gainNode for pitch shifting.
      // Speed is handled both by source.playbackRate AND soundTouchNode.playbackRate
      // (same pattern as normal mode) so that SoundTouch can pitch-correct the
      // tape-speed change introduced by source.playbackRate.
      this.soundTouchNode = new SoundTouchNode(ctx);
      this.soundTouchNode.pitchSemitones.value = this._pitch;
      this.soundTouchNode.playbackRate.value = this._speed;
      this.gainNode.connect(this.soundTouchNode);
      this.soundTouchNode.connect(this.eqFilters[0]);
    } else {
      // ── Normal mode: source → soundTouch → gain → eq → analyser ───────────
      this.sourceNode = ctx.createBufferSource();
      this.sourceNode.buffer = this.audioBuffer!;
      this.sourceNode.playbackRate.value = this._speed;

      this.soundTouchNode = new SoundTouchNode(ctx);
      this.soundTouchNode.playbackRate.value = this._speed;
      this.soundTouchNode.pitchSemitones.value = this._pitch;

      // Connect: source → soundtouch → gain → eq[0..9] → analyser → destination
      this.sourceNode.connect(this.soundTouchNode);
      this.soundTouchNode.connect(this.gainNode);
      this.gainNode.connect(this.eqFilters[0]);

      this.sourceNode.onended = () => {
        if (!this._isPlaying) return;
        this._isPlaying = false;
        this._savedTime = 0;
        this._stopTimeTracking();
        this._teardownPlaybackGraph();
        this.onEnded?.();
      };
      this.sourceNode.start(0, startOffset);
    }
  }

  private _teardownPlaybackGraph(): void {
    // Normal mode: single source node
    if (this.sourceNode) {
      this.sourceNode.onended = null;
      try {
        this.sourceNode.stop();
      } catch {
        // ignore stop on ended/disconnected sources
      }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.soundTouchNode) {
      this.soundTouchNode.disconnect();
      this.soundTouchNode = null;
    }

    // Stem mode: multiple source nodes
    for (const src of this._stemSources) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        /* ignore */
      }
      src.disconnect();
    }
    this._stemSources = [];
    for (const gainNode of this._stemGains.values()) {
      gainNode.disconnect();
    }
    this._stemGains.clear();
  }

  private _startTimeTracking(): void {
    this._stopTimeTracking();
    const tick = () => {
      if (!this._isPlaying) return;
      const time = this.currentTime;
      this.onTimeUpdate?.(time, this._duration);
      this.animFrameId = requestAnimationFrame(tick);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private _stopTimeTracking(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }
}
