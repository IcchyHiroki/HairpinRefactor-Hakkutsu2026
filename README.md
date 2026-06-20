# k8stest1134

このリポジトリには2つのプロジェクトが含まれています。

---

## Project 1: GameServerSet Operator (Kubernetes Custom Controller)

K8s の Deployment/ReplicaSet による即時 Pod 補充を回避し、Pod 削除から復活までに任意の遅延を入れられるカスタムコントローラ。

### 概要

`kubectl delete pod` しても、Controller が Finalizer で削除をブロック → 指定秒数待って → Finalizer 解除 → 新Pod作成、というフローで Pod の復活を遅らせる。

### クイックスタート

```bash
# K8s環境を立ち上げる
minikube start
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

全てのゲーム関連ファイルは `hairpin/` ディレクトリにあります。

### 開発フロー

```bash
cd hairpin

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

### K8s デプロイ

ゲームサーバーは minikube 上の Deployment として動作可能。

```bash
eval $(minikube docker-env)
cd hairpin
docker build -t hairpin-server:latest .
kubectl apply -k deploy/
minikube service hairpin-server
```

### ゲームと K8s の連携

ゲーム内の "pod"（目的地に紐づく仮想エンティティ）は、**実際の K8s Pod** として管理される。

| 仕組み | 説明 |
|--------|------|
| GameServerSet CR `hairpin-game` | replicas=5 で5つの Pod を管理 |
| Pod ラベル `game.example.com/pod-index` | 各 Pod を目的地 ID (0-4) にマッピング |
| ゲーム進行 | 走行距離に応じて `kubectl delete pod` → 27s後復活 |
| 復活後の同期 | `getSession()` が K8s API で Pod 生死を確認 |

### ファイル構成

```
hairpin/
├── server/           # Hono + WebSocket バックエンド（K8s API連携含む）
├── src/              # G2 グラス用フロントエンド
├── mock/             # デスクトップモック (React)
├── deploy/           # K8s マニフェスト
├── Dockerfile
└── package.json
```
