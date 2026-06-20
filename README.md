# k8stest1134

このリポジトリには2つのプロジェクトが含まれています。

---

## Project 1: GameServerSet Operator (Kubernetes Custom Controller)

K8s の Deployment/ReplicaSet による即時 Pod 補充を回避し、Pod 削除から復活までに任意の遅延を入れられるカスタムコントローラ。

### 概要

`kubectl delete pod` しても、Controller が Finalizer で削除をブロック → 指定秒数待って → Finalizer 解除 → 新Pod作成、というフローで Pod の復活を遅らせる。

### クイックスタート

```bash
# CRD をインストール
kubectl apply --server-side -f config/crd/bases/

# サンプル CR を適用
kubectl apply -f config/samples/

# Controller をローカル起動
go run ./cmd/main.go

# 別ターミナルで Pod 削除テスト
kubectl delete pod <gameserverset-pod-name>
```

詳細は `logs/tutorial-complete.md` を参照。

---

## Project 2: Heritage Guide — Even G2 アプリ

**パッケージID**: `jp.hioki.heritage-guide`  
**対象デバイス**: Even Realities G2

神社・文化財をその場で解説するスマートグラス向けガイドアプリ。

### 画面レイアウト（G2表示領域: 576 × 288 px）

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

### 開発フロー

```bash
# 初回セットアップ
npm install

# シミュレータで確認
npm run dev    # Vite dev server → http://localhost:5173
npm run sim    # evenhub-simulator を接続

# 実機デバッグ
npm run dev    # LAN IP でリッスン
npm run qr     # QR コード表示 → Even App でスキャン

# リリースビルド
npm run build
npm run pack   # → heritage-guide.ehpk
```

### ファイル構成

```
src/
├── main.ts       # エントリポイント
├── app.ts        # ステート管理 + EvenHub イベントルーティング
└── glasses.ts    # SDK ラッパー
app.json          # アプリメタデータ（Even App Store 用）
```

詳細は各ソースファイルのコメントを参照。
