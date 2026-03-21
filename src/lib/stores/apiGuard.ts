import { get } from 'svelte/store';
import { settingsStore } from './settingsStore';
import { apiKeyModalStore } from './uiStore';
import { getApiClient } from '../audio/apiClient';
import { BETA_FREE_ACCESS } from '../betaConfig';

/**
 * 設定済みの ApiClient を返す。
 * 未設定の場合はモーダルを表示して null を返す。
 *
 * ベータ期間中（BETA_FREE_ACCESS = true）は apiKey チェックをスキップ。
 * 通常モード（BETA_FREE_ACCESS = false）は apiEndpoint + apiKey が両方必要。
 */
export function getApiClientOrShowModal(): ReturnType<typeof getApiClient> | null {
  const s = get(settingsStore);
  if (!s.apiEndpoint || (!BETA_FREE_ACCESS && !s.apiKey)) {
    apiKeyModalStore.set(true);
    return null;
  }
  return getApiClient(s.apiEndpoint, s.apiKey);
}
