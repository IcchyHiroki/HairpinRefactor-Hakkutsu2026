# このコードを手書きで得られるスキル

## 1. Kubernetes API 基礎

| スキル | 詳細 |
|--------|------|
| API リソースの構造理解 | Pod, Deployment, ReplicaSet, Service, ConfigMap の各フィールドの意味と関係 |
| kubectl 操作の定着 | apply, delete, get, wait, rollout status の実戦 |
| API Server の挙動 | リソース作成/更新/削除時のサーバー側の処理（Validation, Admission, Storage） |

## 2. Controller / Operator パターン

| スキル | 詳細 |
|--------|------|
| Reconciliation Loop の実装 | Reconcile(ctx, req) の中身をゼロから書く経験 |
| 冪等性の設計 | 何度呼ばれても同じ結果になるように書く思考法 |
| エラーとリトライ | エラー発生時の再キューイング（ctrl.Result{}, err） |
| Status 更新の設計 | .Status と .Spec の分離、Conditions パターン |

## 3. controller-runtime ライブラリ

| スキル | 詳細 |
|--------|------|
| Manager の役割 | リーダー選挙、キャッシュ、クライアントのライフサイクル管理 |
| Client の使い分け | r.Get(), r.List(), r.Create(), r.Update(), r.Delete() の実践 |
| インデックス | List 時に効率的にPodを取得するための Field Indexer 設定 |
| Watch / Event ハンドリング | For(), Owns(), Watches() の違いと設定方法 |

## 4. Finalizer の深い理解

| スキル | 詳細 |
|--------|------|
| Finalizer の仕組み | 削除ブロックの原理、DeletionTimestamp との関係 |
| Finalizer の実装パターン | 追加・確認・削除のライフサイクルを自分で書く |
| ガベージコレクションとの関係 | OwnerReference + Finalizer の相互作用 |

## 5. CRD (Custom Resource Definition)

| スキル | 詳細 |
|--------|------|
| CRD の構造 | apiVersion, kind, spec, status の設計方法 |
| marker コメント | // +kubebuilder:... によるバリデーション、生成制御 |
| スキーマ検証 | 必須フィールド、デフォルト値、enum 指定 |
| CRD のバージョニング | v1 → v2 への変換、storage version |

## 6. Go 言語

| スキル | 詳細 |
|--------|------|
| ジェネリクス | controller-runtime 内での制約付きジェネリクスの読み書き |
| interface 設計 | Reconciler、Client、Manager の interface 理解 |
| 構造体タグ | json, yaml, kubebuilder marker の使い分け |
| エラーハンドリング | errors.As(), errors.Is(), fmt.Errorf("%w") |
| context 伝搬 | ctx のタイムアウト・キャンセル・値伝搬 |

## 7. 並行処理・同期

| スキル | 詳細 |
|--------|------|
| goroutine 管理 | Manager 内のワーカーgoroutine の動き |
| リーダー選挙 | etcd ベースの分散ロック、複数Pod時の排他制御 |
| ワークキュー | Reconcile 要求のキューイングと重複排除 |

## 8. Kubernetes リソースライフサイクル

| スキル | 詳細 |
|--------|------|
| Pod の状態遷移 | Pending → ContainerCreating → Running → Terminating |
| OwnerReference | 親リソース削除時のカスケード削除、孤児Podの防止 |
| Pod 削除の内部 | preStop → SIGTERM → terminationGracePeriod → SIGKILL |
| Label / Selector | Controller が自分の管理下のPodを識別する仕組み |

## 9. ビルド・デプロイフロー

| スキル | 詳細 |
|--------|------|
| kubebuilder の make タスク | manifests, generate, install, run, docker-build, deploy |
| minikube へのデプロイ | eval $(minikube docker-env)、内部レジストリの利用 |
| Makefile の読解 | プロジェクト標準のMakefileターゲットの意味 |

## 10. 設計力

| スキル | 詳細 |
|--------|------|
| Operator の責務設計 | 「何を宣言的に管理するか」の境界線の決め方 |
| 既存 Controller との共存 | Deployment/RS Controller と競合しない設計 |
| ゲーム要件とK8sの橋渡し | K8s の原則を壊さずに非標準的な挙動を実現する方法 |

## まとめ

この1つの Operator を手書きすることで、**Kubernetes の内部動作・Controller パターン・Go の実践・分散システム設計** の4領域を横断して習得できる。単なる「kubectl ユーザー」から「K8s を拡張できる層」への一歩になる。
