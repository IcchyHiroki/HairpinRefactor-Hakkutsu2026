# Heritage Guide — Even G2 アプリ

**パッケージID**: `jp.hioki.heritage-guide`  
**バージョン**: 0.1.0  
**対象デバイス**: Even Realities G2  

神社・文化財をその場で解説するスマートグラス向けガイドアプリ。  
左ペインのタイル選択に連動して右ペインの解説テキストが切り替わる、2カラムレイアウトを採用。

---

## 画面レイアウト（G2表示領域: 576 × 288 px）

```
┌───────────────────────────────┬──────────────────────┐
│  タイル（リスト）              │  詳細テキスト         │
│  containerID: 1               │  containerID: 2       │
│  x:0  y:0  w:330  h:288       │  x:340  y:0  w:236   │
│                               │  h:288                │
│  ① 入口の鳥居                  │  正面の鳥居は江戸期の  │
│  ② 拝殿の彫刻                  │  再建。               │
│  ③ 御神木                      │  左の石灯籠に注目。   │
│  🎤 音声で質問                 │                       │
└───────────────────────────────┴──────────────────────┘
```

---

## ファイル構成

```
src/
├── main.ts       # エントリポイント。start() を呼ぶだけ
├── app.ts        # ステート管理 + EvenHub イベントルーティング
└── glasses.ts    # SDK ラッパー（コンテナ生成・テキスト差し替え）
app.json          # アプリメタデータ（Even App Store 用）
```

### 各ファイルの役割

| ファイル | 責務 |
|---|---|
| `main.ts` | `start()` を呼ぶだけのエントリポイント |
| `app.ts` | `STEPS` 配列による画面定義、`listEvent` での選択状態管理 |
| `glasses.ts` | SDK の `createStartUpPageContainer` / `textContainerUpgrade` をラップ |

---

## 開発フロー

### 初回セットアップ

```bash
npm install
```

---

### 1. シミュレータで確認（PC のみ・最速）

```bash
# ターミナル A
npm run dev    # Vite dev server を起動 → http://localhost:5173

# ターミナル B
npm run sim    # evenhub-simulator を localhost:5173 に向けて起動
```

- ホットリロードが効くので、コード変更がリアルタイムで反映される
- シミュレータ上でリスト選択・タップ操作を確認

---

### 2. 実機デバッグ（G2 + スマホを同じ Wi-Fi に接続）

```bash
# ターミナル A
npm run dev    # Vite dev server を起動（PC の LAN IP でリッスン）

# ターミナル B
npm run qr     # ターミナルに QR コードを表示
```

Even App（スマホ側）で QR コードをスキャン → G2 に転送されてライブ確認。  
ホットリロードは効かないが、本物のハードウェア入力で動作確認できる。

> **注意**: `vite.config.ts` で `server.host: true` を設定しないと LAN IP でリッスンされない（後述）。

---

### 3. 実機リリース（パッケージ化してインストール）

```bash
npm run build   # tsc 型チェック + Vite バンドル → dist/
npm run pack    # dist/ + app.json を .ehpk にパック → heritage-guide.ehpk
```

生成した `heritage-guide.ehpk` を Even App 経由でインストール。

---

## コマンド早見表

| コマンド | 用途 |
|---|---|
| `npm run dev` | Vite dev server 起動（ポート 5173） |
| `npm run sim` | シミュレータを dev server に接続して起動 |
| `npm run qr` | 実機デバッグ用 QR コードをターミナルに表示 |
| `npm run build` | 型チェック + プロダクションビルド（→ `dist/`） |
| `npm run pack` | `dist/` を `.ehpk` にパッケージ化 |

---

## Even G2 実装可否チェック

| 項目 | 状況 |
|---|---|
| 表示幅 (330 + 10 gap + 236 = 576 px) | ✅ G2 の表示幅に収まる |
| `createStartUpPageContainer` | ✅ SDK 0.0.10 で対応済み |
| `textContainerUpgrade`（テキスト差し替え） | ✅ SDK 0.0.10 で対応済み |
| `onEvenHubEvent` → `listEvent` | ✅ リスト選択インデックスで追従 |
| マイク権限 (`g2-microphone`) | ✅ `app.json` の `permissions` に宣言済み |
| `audioControl` / 音声入力 (Step 2) | 🔲 未実装。`stt.ts` を追加予定 |
| タグ検索 (Step 3) | 🔲 未実装。`tags.ts` を追加予定 |

---

## 今後のステップ

### Step 2: 音声入力
- `bridge.audioControl(true)` でマイク開始
- `event.audioEvent.audioPcm` (PCM bytes) を受け取り STT API へ送信
- 結果を `updateDetail()` でテキスト表示

### Step 3: タグ検索
- タップイベント (`OsEventTypeList.CLICK_EVENT`) を拾い、NFC/QR/タグと連携
- タグソース抽象 (`tags.ts`) を追加して切り替え可能にする

---

## 依存関係

| パッケージ | バージョン | 用途 |
|---|---|---|
| `@evenrealities/even_hub_sdk` | ^0.0.10 | G2 ブリッジ SDK |
| `@evenrealities/evenhub-cli` | ^0.1.13 | CLI ビルドツール |
| `@evenrealities/evenhub-simulator` | ^0.7.3 | ローカルシミュレータ |
| `vite` | ^8.0.12 | バンドラー |
| `typescript` | ^5.9.3 | 型チェック |
