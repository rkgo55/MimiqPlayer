import { get } from 'svelte/store';
import { playerStore } from '../stores/playerStore';

/**
 * confirm() を表示する前に再生を一時停止し、
 * ダイアログ終了後に再生を復元する。
 * 表示前に再生していなかった場合は復元しない。
 */
export function confirmPaused(message: string): boolean {
  const wasPlaying = get(playerStore).isPlaying;
  if (wasPlaying) playerStore.pause();
  const result = confirm(message);
  if (wasPlaying) playerStore.play();
  return result;
}
