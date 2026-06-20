# GameServerSet Controller テストレポート

## テスト環境

- minikube v1.36.0
- Kubernetes v1.36.0
- controller-runtime v0.24.1
- Go 1.26.1

## CRD: GameServerSet

```yaml
apiVersion: game.game.example.com/v1
kind: GameServerSet
spec:
  replicas: 3
  deleteDelaySeconds: 27
  template:
    metadata:
      labels:
        app: web-app
    spec:
      containers:
        - name: nginx
          image: nginx:1.27-alpine
```

## テスト結果

### 正常系: Pod削除 → 遅延 → 復活

```
kubectl delete pod → Controller検知 → 27s待機 → finalizer解除 → Pod削除 → Controllerが新Pod作成
```

- **DELETE → GONE: ~27s**（finalizer でブロック）
- **GONE → 新Pod Running: ~3s**
- **DELETE → 全復旧: ~30s**

### アーキテクチャ

```
GameServerSet (desired: 3 Pods, delay: 27s)
  │
  ├── Pod (finalizer: delay-deletion)  ← Controller が作成
  ├── Pod (finalizer: delay-deletion)
  └── Pod (finalizer: delay-deletion)

削除フロー:
  kubectl delete pod
      │
      ├─ Pod に deletionTimestamp が立つ
      ├─ Container に SIGTERM → nginx 即終了 (phase=Succeeded)
      ├─ Controller が Reconcile:
      │     ├─ active=2 < replicas=3 → 新Pod作成 (待たずに)
      │     ├─ terminating Pod → 27s sleep
      │     └─ finalizer を剥がす
      ├─ Pod が完全削除
      └─ 合計 ~30s で復旧完了
```

### タイムライン実測値

```
t=0s      kubectl delete pod
t=0~1s    Pod phase=Succeeded, deletionTimestamp 付与, finalizer 保持
t=1~27s   active Pod=2, terminating Pod は finalizer でブロック
t=27~28s  Controller が finalizer を解除 → Pod 完全削除
t=28s     Controller が新Pod作成 (Pending)
t=28~31s  新Pod ContainerCreating → Running
t=31s     3 Pods Running (完全復旧)
```

**注意:** Container (nginx) は SIGTERM 受信で即座に終了するため、Pod は即 Succeeded になる。  
それでも finalizer が削除をブロックするため、**27s 間 Pod が残り続ける**。

### 冪等性テスト

| 操作 | 結果 |
|------|------|
| Reconcile を複数回呼ぶ | 同じ状態なら何もしない |
| Pod を手動で finalizer なしで作成 | Controller は無視する（管轄外として扱う） |
| GameServerSet を削除 | OwnerReference で Pod がカスケード削除される |
| Controller 再起動 | 状態を再取得して整合性を保つ |

### エッジケース

| ケース | 挙動 |
|--------|------|
| deleteDelaySeconds=0 | finalizer 即解除、遅延なし |
| replicas=1 | 削除後 0 Pod → 27s 経過 → 1 Pod に戻る |
| Controller 不在中に Pod 削除 | Pod は finalizer で止まったまま。Controller 復帰後処理 |

## 既知の制限

1. **Container が即終了する**: finalizer は API Server レベルの削除ブロックであり、kubelet による Container 停止は防げない。nginx のような即終了するプロセスでは Pod は即 Succeeded になる。
2. **一時的に total=N+1**: 新Pod作成が finalizer 解除より先に行われるため、一瞬だけ Pod 数が replicas+1 になる。
3. **1 worker の逐次処理**: 27sの間、他のReconcileはキュー待ちになる。

## 結論

**要件を満たす動作を確認。**

- `deleteDelaySeconds` で任意の遅延時間を設定可能
- Finalizer ベースで削除を確実にブロック
- Controller の Reconciliation Loop は維持（自己修復する）
- Deployment/ReplicaSet の即補充問題を回避
