import { writable } from 'svelte/store';

/** Controls the "APIキーが必要" modal visibility */
export const apiKeyModalStore = writable(false);
