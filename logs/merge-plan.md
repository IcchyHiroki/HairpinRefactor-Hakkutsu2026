# マージ計画: Hairpin + GameServerSet Operator

## 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│  minikube クラスタ                                        │
│                                                          │
│  ┌─────────────────────┐    ┌─────────────────────────┐  │
│  │ gss-controller      │    │ hairpin-server          │  │
│  │ (Deployment)        │    │ (Deployment)            │  │
│  │  ─ GameServerSet    │    │  ─ Hono REST API        │  │
│  │    Reconciler       │    │  ─ WebSocket relay       │  │
│  └────────┬────────────┘    └──────────┬──────────────┘  │
│           │                            │                 │
│           │ 管理                       │ 呼び出す         │
│           ▼                            ▼                 │
│  ┌──────────────────────────────────────────────────┐    │
│  │  GameServerSet CR (replicas=5)                   │    │
│  │  ┌──────────────────────────────────────────┐    │    │
│  │  │ Pod(dest1) Pod(dest2) ... Pod(dest5)     │    │    │
│  │  │ label: destination-id = 1..5             │    │    │
│  │  └──────────────────────────────────────────┘    │    │
│  │  deleteDelaySeconds: 27                          │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ゲーム進行:                                               │
│    走行距離 200m → サーバーが Pod(id=1) を kubectl delete   │
│    → Operator が検知 → 27s 待機 → 新 Pod 作成               │
│    → ゲームUI 上は TERMINATED → 復活後 ALIVE に戻る        │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## ゲームの「pod」と K8s Pod の関係

**1つの目的地 = 1つの K8s Pod。** GameServerSet CR が replicas=5 で5つの Pod を管理する。

| 目的地 ID | 名前 | K8s Pod | isReal | 備考 |
|----------|------|---------|--------|------|
| 1 | 東の廃工場 | `game-pod-1` | false | 200m走行でkill |
| 2 | 北の給水塔 | `game-pod-2` | false | 400m走行でkill |
| 3 | 南の地下道 | `game-pod-3` | false | 600m走行でkill |
| 4 | 西の変電所 | `game-pod-4` | false | 800m走行でkill |
| 5 | 中央の格納庫 | `game-pod-5` | true | 正解。killされない |

各 Pod には `destination-id: "1"` のようなラベルが付与され、ゲームサーバーが識別に使う。

## ゲーム進行フロー（K8s 結合あり）

```
プレイヤー走行 200m
  │
  ├─ (1) スマホ/モック → POST /api/game/:sessionId/run
  │
  ├─ (2) サーバー game.ts:updateRunDistance()
  │     ├─ メモリ上の pod.alive = false にする
  │     ├─ kubectl delete pod game-pod-1（destination-id=1）
  │     └─ レスポンスに terminated: [{id:1, name:"東の廃工場"}] を含める
  │
  ├─ (3) GameServerSet Controller が Watch で Pod削除を検知
  │     ├─ active=4 < replicas=5 → 新Pod作成は待つ
  │     └─ terminating Pod → 27s wait → Finalizer解除 → Pod削除
  │
  ├─ (4) ゲームフロント（G2画面）:
  │     ├─ ポーリング（3s間隔）で /api/game/:id を叩く
  │     ├─ サーバー: メモリ上 pod.alive=false + K8s Pod不在 → destination1.alive=false
  │     ├─ UI: 「× 東の廃工場」 / 「TERMINATED」表示
  │     └─ monitor: 同内容をリアルタイム表示
  │
  ├─ (5) 27秒後: GameServerSet が Pod 再作成
  │     ├─ K8s Pod game-pod-1 が復活
  │     ├─ 次のポーリングでサーバーが K8s Pod 存在を確認
  │     └─ destination1.alive = true に戻る
  │
  └─ (6) ゲームUI: 「● 東の廃工場」 表示に戻る
```

## 結合ポイントの詳細

### 1. `server/src/game.ts:68` — updateRunDistance

コメントに書かれている通り、K8s 操作をここに追加する。

```typescript
// Before (現状: メモリ上の操作のみ):
export function updateRunDistance(sessionId: string, distanceMetersAdded: number) {
  // ...
  fakePods[i].alive = false  // メモリ上のフラグだけ変更
  // ...
}

// After (K8s統合後):
import { execSync } from 'child_process'

export function updateRunDistance(sessionId: string, distanceMetersAdded: number) {
  // ...
  fakePods[i].alive = false
  const podName = getPodNameForDestination(fakePods[i].id)
  try {
    execSync(`kubectl delete pod ${podName} -n default`)
  } catch (e) {
    console.error('kubectl delete failed', e)
  }
  // ...
}
```

ただし `execSync('kubectl ...')` はサーバーに `kubectl` バイナリと適切な `~/.kube/config` が必要。

### 2. ゲームサーバー → K8s API 認証

サーバーが K8s クラスタ内で動く場合:

- **In-cluster config**: 自動的に `serviceaccount` のトークンを使う
- **RBAC**: Pod の get/list/delete 権限が必要

K8s クラスタ外の場合:
- `~/.kube/config` または環境変数 `KUBECONFIG` をマウント
- または `K8S_API_TOKEN` などの環境変数で接続

### 3. ゲームサーバーの Pod 管理権限（RBAC）

```yaml
# hairpin/deploy/rbac.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: hairpin-server
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: hairpin-server
rules:
- apiGroups: [""]
  resources: [pods]
  verbs: [get, list, watch, delete]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: hairpin-server
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: hairpin-server
subjects:
- kind: ServiceAccount
  name: hairpin-server
```

### 4. GameServerSet CR と Pod の対応付け

```yaml
# GameServerSet CR（例）
apiVersion: game.game.example.com/v1
kind: GameServerSet
metadata:
  name: hairpin-game
spec:
  replicas: 5
  deleteDelaySeconds: 27
  template:
    metadata:
      labels:
        app: heritage-guide
    spec:
      containers:
      - name: pod
        image: nginx:alpine
        command: ["sleep", "infinity"]  # 単なる目印として待機
```

各 Pod には `game.example.com/gameserverset-name: hairpin-game` ラベルが自動付与される。
ゲームサーバーはこのラベルで全 Pod を一覧取得し、インデックス（0-4）で識別する。

### 5. 復活後の状態同期

Pod が 27 秒後に復活したとき、ゲームサーバーのメモリ状態を K8s 実態と同期する必要がある。

**実装オプション:**

| 方法 | 説明 | 難易度 |
|------|------|--------|
| A: getSession() で K8s Pod 存在確認 | `getSession()` が呼ばれるたびに K8s API で全 Pod の生死をチェック。メモリ状態不要に。 | 中 |
| B: Watch で非同期更新 | K8s Pod の変更を Watch し、メモリ状態を自動更新 | 高 |
| C: 定期 sync | 5秒ごとに K8s Pod 一覧を取得してメモリ状態を書き換え | 低 |
| D: kubectl get pod ラップ | execSync で pod 一覧を取得、生きてる pod だけ alive=true | 低 |

**推奨: 単純さを重視して A と C の組み合わせ。**
- Pod kill 時: `updateRunDistance` でメモリ alive=false + kubectl delete
- 3秒おきのポーリング: ゲームサーバーが K8s API で Pod 一覧を取得し、存在する Pod の alive を true に戻す

---

## スコープ外（今回やらないこと）

| 項目 | 理由 |
|------|------|
| k8s.js のクライアントライブラリ導入 | まずは `execSync('kubectl')` で動かし、必要なら後で `@kubernetes/client-node` に置き換える |
| ゲーム内 pod と K8s Pod のリアルタイム同期 | ポーリングで十分。遅延は最大3秒 |
| monitor.html の K8s ダッシュボード化 | ゲーム監視が目的。Operator 監視は別スコープ |
| 複数ゲームセッションの同時管理 | 現状の in-memory Session をそのまま使う。K8s に移行は後日 |

---

## ファイル整理（Step 0-6）

Step 1-6 のファイル移動・Dockerfile・K8s マニフェスト・README 更新・動作確認は、前回の計画から変更なし。

```
hairpin/              # Heritage Guide G2 アプリ（ゲーム）
├── server/           # Hono + WebSocket バックエンド（K8s API連携含む）
├── src/              # G2 グラス用フロントエンド
├── mock/             # デスクトップモック (React)
├── deploy/           # K8s マニフェスト（Deployment + Service + RBAC）
├── Dockerfile
└── package.json
```

主要な変更箇所（追加分）:

| ファイル | 内容 |
|---------|------|
| `hairpin/server/src/game.ts` | `updateRunDistance` 内で kubectl delete pod を追加 |
| `hairpin/deploy/rbac.yaml` | ServiceAccount + Role + RoleBinding（Pod削除権限） |
| `hairpin/deploy/deployment.yaml` | `serviceAccountName: hairpin-server` を追加 |
| `hairpin/deploy/kustomization.yaml` | rbac.yaml を resources に追加 |
