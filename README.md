<p align="center">
  <img src="public/logo.png" alt="MimiqPlayer">
</p>

# MimiqPlayer - 耳コピ支援ツール

**[https://mimiq-player.rkgoo55.net/](https://mimiq-player.rkgoo55.net/)**

ブラウザ上で動作する耳コピ（音楽の聴き取り）支援 Web アプリである。

ローカル音源を読み込み、速度・ピッチ変更や A-B リピートなどの再生機能を提供する。
BPM / キー / コード解析やボーカル・ドラム・ベースへのステム分離は、外部 API（Modal）サーバーで処理する。

## 機能

### 音源管理・再生

- ローカルファイルをアップロードして IndexedDB に保存する
- 埋め込みタグ（ID3 等）からタイトル・アーティスト・カバー画像を自動表示する
- 再生 / 一時停止 / 停止、シークバー付き波形表示に対応する
- 設定可能な秒数で前後スキップできる

### 耳コピ支援

- 速度変更: 0.25x〜2.0x（ピッチ維持）
- ピッチ変更: ±12 半音（速度維持）
- A-B リピートによる区間ループ再生
- A-B 区間を名前付きブックマークとして保存・再利用できる
- 10 バンド EQ（プリセットと手動調整に対応）
- キーボードショートカット（Space、←→、A / B / R キー）

### 音楽解析（API）

AI 解析機能は外部 API サーバーを利用する。APIキーは管理人（[@rkgoo55](https://www.instagram.com/rkgoo55/)）に問い合わせること。

- BPM 推定
- キー推定
- コード進行表示（再生位置に応じたコードをリアルタイム表示）
- 解析結果を IndexedDB にキャッシュし、2 回目以降は即座に表示する

### ステム分離（API）

- ボーカル・ドラム・ベース・その他・ギター・ピアノの 6 ステムに分離する
- 各ステムの音量を個別に調整できるステムミキサーを備える

## 技術スタック

| 種別 | 内容 |
|------|------|
| フロントエンド | Svelte 5 + TypeScript |
| ビルドツール | Vite 7 |
| スタイリング | Tailwind CSS v4 |
| 音声再生 | Web Audio API + `@soundtouchjs/audio-worklet`（速度 / ピッチ変換） |
| AI 処理 | 外部 API サーバー（Modal）|
| メタデータ解析 | `music-metadata` 11.12.2 |
| DB | `idb` 8.0.3（IndexedDB ラッパー） |
| テスト | Vitest 4 + jsdom |
| PWA | `vite-plugin-pwa` |
| タスクランナー | just |

## アーキテクチャ

```
メインスレッド
├── AudioEngine.ts          … Web Audio API + SoundTouchJS（速度 / ピッチ / EQ）
└── apiClient.ts            … Modal API クライアント（BPM / Key / Chord / ステム分離）

IndexedDB
├── 音声ファイル本体
├── トラックメタデータ（タイトル・アーティスト・カバー画像・EQ・ブックマーク等）
└── 解析結果キャッシュ（BPM・キー・コード進行）
```

- 解析・分離処理はすべてサーバーサイドで実行し、結果を IndexedDB にキャッシュする
- APIキー未設定の場合、AI 機能ボタンをクリックするとモーダルで連絡先を案内する