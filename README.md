<p align="center">
  <img src="public/logo.png" alt="MimiqPlayer">
</p>

# MimiqPlayer - 耳コピ支援ツール

ブラウザ上で動作する耳コピ（音楽の聴き取り）支援 Web アプリである。

ローカル音源を読み込み、速度・ピッチ変更や A-B リピートなどの再生機能を提供する。
BPM / キー / コード解析やボーカル・ドラム・ベースへのステム分離まで、すべてブラウザ完結で動作する。

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

### 音楽解析

- BPM 推定: `RhythmExtractor2013` を優先し、失敗時は `PercivalBpmEstimator` へフォールバックする
- キー推定: `KeyExtractor` の高分解能設定で調性を判定する
- コード表示: `TonalExtractor` ベースで推定し、再生位置に応じたコードを表示する
- BPM / キー / コード進行の解析結果を IndexedDB にキャッシュし、2 回目以降は即座に表示する

### ステム分離

- ボーカル・ドラム・ベース・その他の 4 ステムに分離する（htdemucs モデル使用）
- 各ステムの音量を個別に調整できるステムミキサーを備える
- WebGPU を優先使用し、非対応環境は WASM へ自動フォールバックする

## 技術スタック

| 種別 | 内容 |
|------|------|
| フロントエンド | Svelte 5 + TypeScript |
| ビルドツール | Vite 7 |
| スタイリング | Tailwind CSS v4 |
| 音声再生 | Web Audio API + `@soundtouchjs/audio-worklet`（速度 / ピッチ変換） |
| 音楽解析 | `essentia.js` 0.1.3（WASM） |
| ステム分離 | `onnxruntime-web` 1.24.3 + `@huggingface/transformers` 3.8.1 |
| メタデータ解析 | `music-metadata` 11.12.2 |
| DB | `idb` 8.0.3（IndexedDB ラッパー） |
| テスト | Vitest 4 + jsdom |
| PWA | `vite-plugin-pwa` |
| タスクランナー | just |

## アーキテクチャ

重い処理は 2 つの Web Worker に分離し、UI スレッドの応答性を保つ構成である。

```
メインスレッド
├── AudioEngine.ts          … Web Audio API + SoundTouchJS（速度 / ピッチ / EQ）
├── AudioAnalysisWorkerClient.ts
│     └── AudioAnalysisWorker.ts [Worker]
│           └── Essentia.js WASM（BPM / Key / Chord）
└── StemSeparationClient.ts
      └── OrtStemSeparationWorker.ts [Worker]
            └── onnxruntime-web（WebGPU → WASM フォールバック）

IndexedDB
├── 音声ファイル本体
├── トラックメタデータ（タイトル・アーティスト・カバー画像・EQ・ブックマーク等）
└── 解析結果キャッシュ（BPM・キー・コード進行）
```

- アプリ起動時に Essentia WASM をウォームアップして、初回解析の待ち時間を短縮する
- ステム分離は WebGPU を優先し、非対応環境は WASM へ自動フォールバックする

## デプロイ

`main` ブランチへの push 時に GitHub Pages へ自動デプロイされる。