# GameServerSet Operator 開発フロー

## 概要

ゲーム用の Custom Controller。Pod 削除時に指定秒数待ってから新Podを作ることで、一時的にPod数を減らす挙動を実現する。

## 全体アーキテクチャ

```
kubectl apply -f gameserverset.yaml
  │
  └─ Controller が以下を管理:
       ├── CRD: GameServerSet (desired state)
       ├── Pod (finalizer 付き)
       └── Finalizer で削除をブロック

削除フロー:
  kubectl delete pod web-app-x
      │
      ├─ Controller が DeletionTimestamp を検知
      ├─ deleteDelaySeconds だけ sleep
      ├─ Finalizer を外す → Pod が完全削除
      └─ 新 Pod を作成
         ↓
    この間、active Pod 数は N-1
```

## CRD 設計

```yaml
apiVersion: game.example.com/v1
kind: GameServerSet
metadata:
  name: web-app
spec:
  replicas: 3
  deleteDelaySeconds: 27
  template:
    spec:
      containers:
        - name: nginx
          image: nginx:1.27-alpine
```

## ディレクトリ構成

```
gameserver-operator/
├── api/
│   └── v1/
│       ├── gameserverset_types.go    # CRD struct
│       └── groupversion_info.go      # GVK 定義
├── internal/
│   └── controller/
│       └── gameserverset_controller.go  # Reconciler 本体
├── config/
│   ├── crd/          # CRD manifests (make manifests で自動生成)
│   ├── rbac/         # ServiceAccount, Role, RoleBinding
│   ├── manager/      # Controller Deployment
│   └── samples/      # CR サンプル
├── main.go
├── Dockerfile
├── Makefile
└── go.mod
```

## 実装ステップ

### Step 1: プロジェクト初期化

```bash
kubebuilder init --domain game.example.com --repo github.com/you/gameserver-operator
kubebuilder create api --group game --version v1 --kind GameServerSet --resource=true --controller=true
```

### Step 2: CRD 定義（api/v1/gameserverset_types.go）

```go
type GameServerSetSpec struct {
    Replicas           *int32                `json:"replicas"`
    DeleteDelaySeconds *int32                `json:"deleteDelaySeconds"`
    Template           corev1.PodTemplateSpec `json:"template"`
}
type GameServerSetStatus struct {
    ReadyReplicas int32             `json:"readyReplicas,omitempty"`
    Conditions    []metav1.Condition `json:"conditions,omitempty"`
}
```

### Step 3: Reconciler 実装

**Reconcile ループの流れ:**

```
Reconcile(ctx, req)
  │
  ├─ (1) GameServerSet を取得
  │
  ├─ (2) 管理下の Pod 一覧を取得 (labels selector)
  │
  ├─ (3) 削除中の Pod (DeletionTimestamp != nil) と active Pod に分類
  │
  ├─ (4) active Pod < spec.replicas → 新 Pod 作成
  │
  ├─ (5) 削除中の Pod ごとに:
  │      ├── Finalizer (delay.game.example.com) がなければ追加
  │      ├── あれば deleteDelaySeconds だけ sleep
  │      └── Finalizer を削除 → Pod が完全に消える
  │
  └─ (6) Status 更新 (ReadyReplicas)
```

### Step 4: Watch 設定

```go
ctrl.NewControllerManagedBy(mgr).
    For(&gamev1.GameServerSet{}).
    Owns(&corev1.Pod{}).   // Pod変更→自動Reconcile
    Complete(r)
```

### Step 5: ローカル検証

```bash
make install              # CRD を minikube に登録
make run                  # Controller をローカルプロセスで起動

# 別ターミナル
kubectl apply -f config/samples/game_v1_gameserverset.yaml
kubectl get pod -w
kubectl delete pod <name>
# → 27s 待ってから新Podが作られることを確認
```

### Step 6: コンテナ化 & クラスタデプロイ

```bash
eval $(minikube docker-env)
make docker-build IMG=gameserver-controller:latest
make deploy IMG=gameserver-controller:latest
```

### Step 7: 冪等性・エラーハンドリング

- 何度 Reconcile が呼ばれても同じ結果
- Finalizer の有無を必ずチェックしてから追加/削除
- エラーは `return ctrl.Result{}, err` → 自動リトライ
- Leader Election で複数Podの競合防止

## 期待される動作

| 操作 | 経過時間 | active Pod数 | 備考 |
|------|---------|-------------|------|
| 初期状態 | 0s | 3 | |
| `kubectl delete pod web-app-1` | 即時 | 2 | Finalizer でブロック |
| | ~27s | 2 | sleep中 |
| | 27s後 | 2 → 3 | Finalizer解除→Pod削除→新Pod作成 |
| | 30s後 | 3 | 新Pod Ready |

## 注意点

- Deployment / ReplicaSet は使わない（即補充を防ぐため）
- Controller が直接 Pod を管理・作成する
- Pod に OwnerReference (GameServerSet) を付けて紐付ける
- Status.Conditions で状態を可視化する
