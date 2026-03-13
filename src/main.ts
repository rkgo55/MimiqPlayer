import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

// iOS Safari はデフォルトでストレージを 7 日後に消去することがある。
// persist() を呼ぶとユーザーの許可なしに永続化される（Chrome）か、
// 許可ダイアログを表示する（Firefox）。iOS では効果が限定的だが念のため試みる。
if ('storage' in navigator && 'persist' in navigator.storage) {
  void navigator.storage.persist();
}

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
