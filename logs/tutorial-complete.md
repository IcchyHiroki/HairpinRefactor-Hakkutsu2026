# GameServerSet Operator 完全チュートリアル

## 対象読者

- Kubernetes の基本操作（`kubectl get/apply/delete`）ができる
- Go の基本的な文法（構造体、関数、エラーハンドリング）がわかる
- Container / Docker の概念を理解している
- **「K8s を拡張する側」になりたい人**

---

## A. 背景と目的

### このチュートリアルで作るもの

**GameServerSet Controller** という Custom Controller（Operator）を作る。

### 何ができるか

```
kubectl delete pod gameserver-sample-xxx
  ↓ 27秒待つ（他のPodは減ったまま）
  ↓ 新しいPodが作られる
```

Pod を削除してから復活するまでに **任意の秒数（例: 27秒）の遅延** を入れられる。

### なぜ必要か

普通の Deployment で管理された Pod を `kubectl delete` すると:

```
kubectl delete pod web-app-xxx
  │
  ├─ Pod が Terminating になる
  └─ ReplicaSet Controller が即座に「Podが1個足りない！」と検知
       → 新しいPodを即作成
```

**一瞬も Pod 数が減らない。** ゲームの演出上「削除された感」を出したい場合に困る。

### 解決方法

**Deployment/ReplicaSet Controller を使わない。** 代わりに自前の Controller が Pod を直接管理する。

```
Controller が Pod を直接作り、直接管理する
  │
  ├─ Pod に Finalizer を付けて削除をブロック
  ├─ 指定秒数待つ
  └─ Finalizer を解除 → 実際に Pod が消える
```

---

## B. 前提知識と環境

### 必要なツール

| ツール | バージョン（例） | 役割 |
|--------|-----------------|------|
| Go | 1.22+ | Controller のプログラミング言語 |
| kubebuilder | v4 | Operator プロジェクトの雛形生成 |
| minikube | 任意 | ローカル K8s クラスタ |
| kubectl | クラスタと一致 | K8s API 操作 |
| Docker | 任意 | Controller のコンテナイメージ作成 |

### インストール確認

```bash
go version
kubebuilder version
minikube version
kubectl version --client
docker version
```

### minikube 起動

```bash
minikube start --cpus=2 --memory=2048
kubectl cluster-info
```

---

## C. K8s 概念解説（このチュートリアルで必要なものだけ）

### C-1. CRD（Custom Resource Definition）

**K8sのAPIに、自分だけのリソースタイプを追加する仕組み。**

```
標準のK8sリソース: Pod, Service, Deployment, ConfigMap, ...
カスタムリソース: GameServerSet, MyApp, Backup, Database, ...
```

CRD を定義すると `kubectl get gameserverset` が使えるようになる。

**今回使うカスタムリソース:**

```yaml
apiVersion: game.game.example.com/v1
kind: GameServerSet
spec:
  replicas: 3
  deleteDelaySeconds: 27
  template:
    spec:
      containers:
        - name: nginx
          image: nginx:1.27-alpine
```

### C-2. Controller / Operator パターン

**CRD で定義した「あるべき姿（desired state）」を、実際のクラスタ状態に収束させるプログラム。**

```
Controller の仕事:
  無限ループで以下を繰り返す:
    1. CR の spec を読む（replicas: 3）
    2. 現在の Pod の数を数える
    3. 差分があれば Pod を作成/削除して一致させる
```

### C-3. Reconciliation Loop

Controller の中核:

```
Reconcile(ctx, req) → (Result, error)
  │
  ├─ リソースを取得
  ├─ 現在の状態を収集
  ├─ desired と比較
  ├─ 差分を埋める操作を実行
  └─ Status を更新
```

- **冪等性（Idempotency）:** 何度呼んでも同じ結果になること
- **エラーの自動リトライ:** エラーを返すと K8s が自動で再実行

### C-4. Finalizer

**リソースの削除をブロックする鍵。**

```
Pod に Finalizer が付いている状態で kubectl delete すると:
  ├─ Pod に deletionTimestamp がセットされる（削除予約）
  ├─ でも Pod は消えない（Finalizer がブロック）
  └─ Controller が Finalizer を外す → 初めて Pod が消える
```

### C-5. OwnerReference

**親リソースと子リソースの親子関係を定義する。**

```
GameServerSet (親)
  └── Pod (子, OwnerReference で親を指す)

親を削除 → 子も自動削除（ガベージコレクション）
```

### C-6. controller-runtime

K8s Controller を書くためのフレームワーク。主な構成要素:

| 要素 | 役割 |
|------|------|
| Manager | Controller 全体のライフサイクル管理 |
| Reconciler | Reconcile 関数を実装するインターフェース |
| Client | API Server との読み書き（キャッシュ付き） |
| Cache | API Server のリソースをローカルにキャッシュ |
| Controller | Reconciler + Watch を束ねる |

---

## D. プロジェクト初期化

### D-1. kubebuilder で雛形生成

```bash
# プロジェクトディレクトリを作成
mkdir -p gameserver-operator && cd gameserver-operator

# プロジェクト初期化
kubebuilder init --domain game.example.com --repo github.com/you/gameserver-operator

# CRD + Controller の雛形を生成
kubebuilder create api \
  --group game \
  --version v1 \
  --kind GameServerSet \
  --resource=true \
  --controller=true
```

### D-2. 生成されるファイル構成

```
gameserver-operator/
├── api/v1/
│   ├── gameserverset_types.go     ← 編集する（CRDの型定義）
│   └── groupversion_info.go       ← GVKの登録（基本触らない）
├── internal/controller/
│   └── gameserverset_controller.go ← 編集する（Reconciler 本体）
├── cmd/main.go                     ← 編集する場合あり
├── config/
│   ├── crd/                        ← 自動生成（触らない）
│   ├── rbac/                       ← 自動生成（触らない）
│   └── samples/                    ← サンプルCR
├── Dockerfile
├── Makefile
└── go.mod
```

---

## E. CRD 型定義

`api/v1/gameserverset_types.go` を以下のように書く。

### 完成コード

```go
package v1

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

const (
	GameServerSetKind       = "GameServerSet"
	GameServerSetPodFinalizer = "gameserverset.game.example.com/delay-deletion"
	GameServerSetLabelKey   = "game.example.com/gameserverset-name"
)

// ─── Spec ────────────────────────────────────────────────
type GameServerSetSpec struct {
	Replicas           *int32      `json:"replicas"`
	DeleteDelaySeconds *int32      `json:"deleteDelaySeconds"`
	Template           PodTemplate `json:"template"`
}

type PodTemplate struct {
	// +optional
	ObjectMeta PodTemplateObjectMeta `json:"metadata,omitempty"`
	Spec       corev1.PodSpec        `json:"spec"`
}

type PodTemplateObjectMeta struct {
	// +optional
	Labels map[string]string `json:"labels,omitempty"`
	// +optional
	Annotations map[string]string `json:"annotations,omitempty"`
}

// ─── Status ──────────────────────────────────────────────
type GameServerSetStatus struct {
	ReadyReplicas int32              `json:"readyReplicas,omitempty"`
	Conditions    []metav1.Condition `json:"conditions,omitempty"`
}

// ─── CRD 本体 ─────────────────────────────────────────────
// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced
// +kubebuilder:printcolumn:name="Replicas",type=integer,JSONPath=".spec.replicas"
// +kubebuilder:printcolumn:name="Ready",type=integer,JSONPath=".status.readyReplicas"
// +kubebuilder:printcolumn:name="Delay",type=integer,JSONPath=".spec.deleteDelaySeconds"
type GameServerSet struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitzero"`

	Spec   GameServerSetSpec   `json:"spec"`
	Status GameServerSetStatus `json:"status,omitzero"`
}

// +kubebuilder:object:root=true
type GameServerSetList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitzero"`
	Items           []GameServerSet `json:"items"`
}

func init() {
	SchemeBuilder.Register(func(s *runtime.Scheme) error {
		s.AddKnownTypes(SchemeGroupVersion, &GameServerSet{}, &GameServerSetList{})
		return nil
	})
}
```

### 各行の解説

| コード | 説明 |
|--------|------|
| `GameServerSetPodFinalizer` | Podに付与するFinalizer名。「このFinalizerを持つPodは削除ブロック対象」という合言葉 |
| `GameServerSetLabelKey` | Controller が自分の管理下のPodを識別するためのラベルキー |
| `Replicas *int32` | 希望するPod数。ポインタ型 = 省略可能 |
| `DeleteDelaySeconds *int32` | 削除を遅延する秒数 |
| `Template PodTemplate` | 作成するPodの雛形。PodTemplateSpecをそのまま使うとCRDが巨大化するため独自型に |
| `PodTemplate` | PodTemplateSpecを簡略化。`ObjectMeta` に labels だけ、`Spec` は PodSpec そのまま |
| `+kubebuilder:printcolumn` | `kubectl get` の出力に追加カラムを定義 |
| `omitzero` | ゼロ値のときJSONに出力しない（Go 1.24+） |

### なぜ PodTemplateSpec ではなく自作の PodTemplate を使うか

**`corev1.PodTemplateSpec` を使うと CRD のサイズが 600KB になり、K8s の上限 256KB（annotation）を超える。**

そこで、必要なフィールド（labels, annotations, PodSpec）だけを持つ独自構造体を定義して回避する。

---

## F. CRD マニフェスト生成とインストール

### F-1. DeepCopy メソッド生成

```bash
# controller-gen をインストール（初回のみ）
go install sigs.k8s.io/controller-tools/cmd/controller-gen@v0.21.0

# DeepCopy メソッドを自動生成
controller-gen object:headerFile=hack/boilerplate.go.txt,year=2026 paths="./api/..."

# CRD + RBAC マニフェストを生成
controller-gen rbac:roleName=manager-role crd webhook paths="./..." \
  output:crd:artifacts:config=config/crd/bases
```

### F-2. CRD をクラスタにインストール

```bash
# CRD のサイズが大きいため server-side apply が必要
kubectl apply --server-side -f config/crd/bases/game.game.example.com_gameserversets.yaml
```

### F-3. サンプル CR

`config/samples/game_v1_gameserverset.yaml`:

```yaml
apiVersion: game.game.example.com/v1
kind: GameServerSet
metadata:
  name: gameserverset-sample
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
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
      terminationGracePeriodSeconds: 5
```

```bash
kubectl apply -f config/samples/game_v1_gameserverset.yaml
```

---

## G. Reconciler 実装（本丸）

`internal/controller/gameserverset_controller.go` の全コード。

### 完成コード

```go
package controller

import (
	"context"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
	logf "sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/predicate"

	gamev1 "github.com/you/gameserver-operator/api/v1"
)

const controllerName = "gameserverset"
const delayFinalizer = gamev1.GameServerSetPodFinalizer

// ─── Reconciler 構造体 ───────────────────────────────────
// Client と Scheme は Manager から注入される
type GameServerSetReconciler struct {
	client.Client
	Scheme *runtime.Scheme
}

// ─── RBAC 権限マーカー ───────────────────────────────────
// +kubebuilder:rbac:groups=game.game.example.com,resources=gameserversets,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=game.game.example.com,resources=gameserversets/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=game.game.example.com,resources=gameserversets/finalizers,verbs=update
// +kubebuilder:rbac:groups=core,resources=pods,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=core,resources=pods/finalizers,verbs=update

// ─── Reconcile 関数 ──────────────────────────────────────
func (r *GameServerSetReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := logf.FromContext(ctx).WithName(controllerName)

	// ── (1) GameServerSet CR を取得 ──
	gss := &gamev1.GameServerSet{}
	if err := r.Get(ctx, req.NamespacedName, gss); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	replicas := int32(1)
	if gss.Spec.Replicas != nil && *gss.Spec.Replicas > 0 {
		replicas = *gss.Spec.Replicas
	}
	delaySec := int32(0)
	if gss.Spec.DeleteDelaySeconds != nil && *gss.Spec.DeleteDelaySeconds > 0 {
		delaySec = *gss.Spec.DeleteDelaySeconds
	}

	// ── (2) 管理下の Pod 一覧を取得 ──
	// Label を使って自分の Pod だけを取得する
	var pods corev1.PodList
	if err := r.List(ctx, &pods,
		client.InNamespace(req.Namespace),
		client.MatchingLabels{gamev1.GameServerSetLabelKey: gss.Name},
	); err != nil {
		return ctrl.Result{}, err
	}

	// ── (3) active Pod と terminating Pod に分離 ──
	var activePods []corev1.Pod
	var terminatingPods []corev1.Pod
	for _, pod := range pods.Items {
		if pod.DeletionTimestamp != nil {
			terminatingPods = append(terminatingPods, pod)
		} else {
			activePods = append(activePods, pod)
		}
	}

	// ── (4) 削除中の Pod を処理（ここが遅延の核心） ──
	for i := range terminatingPods {
		pod := terminatingPods[i]
		log := log.WithValues("pod", pod.Name)

		// 自分の Finalizer がなければスキップ（他者の管理下 or 最終処理済み）
		if !hasFinalizer(&pod, delayFinalizer) {
			continue
		}

		// 指定秒数 sleep
		log.Info("Waiting before allowing pod deletion", "delaySeconds", delaySec)
		select {
		case <-time.After(time.Duration(delaySec) * time.Second):
		case <-ctx.Done():
			return ctrl.Result{}, ctx.Err()
		}

		// 最新の Pod を再取得（楽観的ロック対策）
		latest := &corev1.Pod{}
		if err := r.Get(ctx, types.NamespacedName{
			Name: pod.Name, Namespace: pod.Namespace,
		}, latest); err != nil {
			log.Error(err, "Failed to re-fetch pod")
			continue
		}
		if !hasFinalizer(latest, delayFinalizer) {
			continue
		}

		// Finalizer を外す → Pod が完全削除される
		log.Info("Removing delay finalizer, allowing pod deletion")
		removeFinalizer(latest, delayFinalizer)
		if err := r.Update(ctx, latest); err != nil {
			log.Error(err, "Failed to remove finalizer, skipping")
			continue
		}
	}

	// ── (5) 不足 Pod を作成 ──
	activeCount := int32(len(activePods))
	if activeCount < replicas {
		desiredNew := replicas - activeCount
		log.Info("Creating new pods", "count", desiredNew, "active", activeCount, "desired", replicas)
		for i := int32(0); i < desiredNew; i++ {
			pod := buildPod(gss)
			// OwnerReference をセット → 親削除時に子も自動削除
			if err := ctrl.SetControllerReference(gss, pod, r.Scheme); err != nil {
				return ctrl.Result{}, err
			}
			if err := r.Create(ctx, pod); err != nil {
				return ctrl.Result{}, err
			}
		}
	}

	// ── (6) Status 更新 ──
	var readyCount int32
	for _, pod := range activePods {
		for _, cond := range pod.Status.Conditions {
			if cond.Type == corev1.PodReady && cond.Status == corev1.ConditionTrue {
				readyCount++
				break
			}
		}
	}
	if gss.Status.ReadyReplicas != readyCount {
		gss.Status.ReadyReplicas = readyCount
		if err := r.Status().Update(ctx, gss); err != nil {
			log.V(1).Info("Status update conflict, will retry", "error", err.Error())
			return ctrl.Result{}, err
		}
	}

	return ctrl.Result{}, nil
}

// ─── Watch 設定 ──────────────────────────────────────────
func (r *GameServerSetReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&gamev1.GameServerSet{}).   // GameServerSet の変更を監視
		Owns(&corev1.Pod{}).            // 管理下の Pod の変更も監視
		Named(controllerName).
		WithEventFilter(podStatusChangePredicate()).
		Complete(r)
}

// ─── Pod 作成ヘルパー ────────────────────────────────────
func buildPod(gss *gamev1.GameServerSet) *corev1.Pod {
	labels := make(map[string]string)
	for k, v := range gss.Spec.Template.ObjectMeta.Labels {
		labels[k] = v
	}
	labels[gamev1.GameServerSetLabelKey] = gss.Name

	annotations := make(map[string]string)
	for k, v := range gss.Spec.Template.ObjectMeta.Annotations {
		annotations[k] = v
	}

	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			GenerateName: gss.Name + "-",
			Namespace:    gss.Namespace,
			Labels:       labels,
			Annotations:  annotations,
			Finalizers:   []string{delayFinalizer}, // ← Pod 作成時に Finalizer を付与！
		},
		Spec: gss.Spec.Template.Spec,
	}
}

// ─── Finalizer 操作 ──────────────────────────────────────
func hasFinalizer(pod *corev1.Pod, finalizer string) bool {
	for _, f := range pod.Finalizers {
		if f == finalizer {
			return true
		}
	}
	return false
}

func removeFinalizer(pod *corev1.Pod, finalizer string) {
	var updated []string
	for _, f := range pod.Finalizers {
		if f != finalizer {
			updated = append(updated, f)
		}
	}
	pod.Finalizers = updated
}

// ─── イベントフィルター ──────────────────────────────────
func podStatusChangePredicate() predicate.Predicate {
	return predicate.Funcs{
		UpdateFunc:  func(e event.UpdateEvent) bool { return true },
		CreateFunc:  func(e event.CreateEvent) bool { return true },
		DeleteFunc:  func(e event.DeleteEvent) bool { return true },
		GenericFunc: func(e event.GenericEvent) bool { return false },
	}
}
```

### コード解説（重要箇所）

#### Reconcile の流れ

```
Reconcile(ctx, req)
  │
  ├─ (1) GameServerSet CR を取得 ─────────────────────────────
  │   読み込めなければ NotFound は無視、その他はエラー
  │
  ├─ (2) 管理下の Pod 一覧を取得 ─────────────────────────────
  │   Label: game.example.com/gameserverset-name = <CR名>
  │   このラベルが付いた Pod だけが自分の管理下
  │
  ├─ (3) active / terminating に分類 ────────────────────────
  │   DeletionTimestamp != nil → 削除予約中（終了処理中)
  │   DeletionTimestamp == nil → 正常稼働中
  │
  ├─ (4) terminating Pod の処理 ─────────────────────────────
  │     [A] Finalizer がなければスキップ（他者が管理 or 処理済み）
  │     [B] deleteDelaySeconds だけ sleep
  │     [C] Pod を再取得（楽観的ロック対策）
  │     [D] Finalizer を削除 → API Server が Pod を完全削除
  │
  ├─ (5) 不足 Pod を作成 ────────────────────────────────────
  │   active < replicas → 新しい Pod を create
  │   OwnerReference をセット → 親削除時にカスケード削除
  │
  └─ (6) Status 更新 ───────────────────────────────────────
      Ready な Pod の数を数えて Status.ReadyReplicas に書き込む
```

#### なぜ Pod を再取得するのか（楽観的ロック対策）

```
問題:
  sleep している間に Pod の Status が変わる（kubelet が Succeeded に更新）
  → 古い resourceVersion で Update しようとすると Conflict エラー

解決:
  sleep 後に Get で最新版を取得 → その resourceVersion で Update
```

#### なぜ PodTemplateSpec を直接使わず自作の PodTemplate 構造体を使うか

`corev1.PodTemplateSpec` は K8s の標準型だが、controller-gen が生成する CRD スキーマが**巨大（600KB超）**になる。すると `kubectl apply` の annotation 上限（256KB）を超えて登録できない。

**回避策:** Pod の spec 部分だけ `corev1.PodSpec` を使い、metadata 部分は labels と annotations だけを持つ簡略構造体に置き換える。

#### 冪等性の考慮

- **Pod 作成:** `GenerateName` を使うので複数回呼ばれても同名で競合しない
- **Finalizer 追加:** 既にあればスキップ
- **Finalizer 削除:** 既になければスキップ
- **Status 更新:** 値が変わっていれば更新、同じならスキップ

---

## H. ローカル検証

### H-1. CRD のインストール

```bash
# CRD を minikube に登録
kubectl apply --server-side \
  -f config/crd/bases/game.game.example.com_gameserversets.yaml
```

### H-2. サンプル CR を適用

```bash
kubectl apply -f config/samples/game_v1_gameserverset.yaml
kubectl get gameserverset
# → REPLICAS=3, READY=0, DELAY=27
```

### H-3. Controller をローカル起動

```bash
go run ./cmd/main.go
```

このプロセスが Controller。クラスタの外から API Server を経由して Pod を管理する。
**このプロセスを止めると管理が止まるので注意。**

### H-4. Pod が作られることを確認

```bash
# 別ターミナルで
kubectl get pod -w
# → gameserverset-sample-xxx が3つ Running になる
```

### H-5. Pod 削除 → 遅延テスト

```bash
# タイムスタンプを計測しながら
POD=$(kubectl get pod -l game.example.com/gameserverset-name=gameserverset-sample \
  -o name | tail -1)
echo "DELETE at $(date +%T.%3N)"
kubectl delete "$POD" --wait=false

# 確認: すぐに新しいPodが作られないことを確認
# 約27秒後に古いPodが消え、新しいPodが作られる
kubectl get pod -l game.example.com/gameserverset-name=gameserverset-sample -w
```

### 期待されるタイムライン

```
t=0s    kubectl delete pod → deletionTimestamp セット, nginx 即終了
t=0~27s Pod は Finalizer でブロック中（kubectl 上は Completed 表示）
t=27s   Controller が Finalizer 解除 → Pod 完全削除 → 新Pod作成
t=30s   新Pod Running（復旧完了）
```

### Controller のログで確認

Controller を起動したターミナルに以下のログが出る:

```
Waiting before allowing pod deletion  delaySeconds=27  pod=gameserverset-xxx
Removing delay finalizer, allowing pod deletion  pod=gameserverset-xxx
Creating new pods  count=1  active=2  desired=3
```

---

## I. クラスタデプロイ（永続運用）

ローカルプロセスはターミナルを閉じると死ぬ。Controller をクラスタ内の Deployment としてデプロイすれば、落ちても K8s が自動再起動する。

### I-1. Docker イメージビルド

```bash
# minikube の Docker デーモンを使用
eval $(minikube docker-env)

# イメージビルド
docker build -t controller:latest .
```

### I-2. RBAC + Deployment の適用

手動で適用する場合。以下を 1 ファイルにまとめて `kubectl apply -f` する。

```yaml
# deploy-controller.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: gss-controller
  namespace: default
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: gss-controller-role
rules:
- apiGroups: [game.game.example.com]
  resources: [gameserversets, gameserversets/status, gameserversets/finalizers]
  verbs: [get, list, watch, create, update, patch, delete]
- apiGroups: [""]
  resources: [pods, pods/finalizers]
  verbs: [get, list, watch, create, update, patch, delete]
- apiGroups: [""]
  resources: [configmaps]
  verbs: [get, list, watch, create, update, patch, delete]
- apiGroups: [coordination.k8s.io]
  resources: [leases]
  verbs: [get, list, watch, create, update, patch, delete]
- apiGroups: [""]
  resources: [events]
  verbs: [create, patch]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: gss-controller-rolebinding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: gss-controller-role
subjects:
- kind: ServiceAccount
  name: gss-controller
  namespace: default
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gss-controller
  namespace: default
  labels:
    control-plane: gss-controller
spec:
  selector:
    matchLabels:
      control-plane: gss-controller
  replicas: 1
  template:
    metadata:
      labels:
        control-plane: gss-controller
    spec:
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
      - command: [/manager]
        args:
        - --leader-elect
        - --health-probe-bind-address=:8081
        image: controller:latest
        imagePullPolicy: Never
        name: manager
        livenessProbe:
          httpGet:
            path: /healthz
            port: 8081
          initialDelaySeconds: 15
          periodSeconds: 20
        readinessProbe:
          httpGet:
            path: /readyz
            port: 8081
          initialDelaySeconds: 5
          periodSeconds: 10
        resources:
          limits:
            cpu: 500m
            memory: 128Mi
          requests:
            cpu: 10m
            memory: 64Mi
      serviceAccountName: gss-controller
      terminationGracePeriodSeconds: 10
```

```bash
kubectl apply -f deploy-controller.yaml

# 起動確認
kubectl get pod -l control-plane=gss-controller -w
```

`imagePullPolicy: Never` を指定しているため、minikube 内の Docker デーモンにビルドした `controller:latest` イメージが使われる。

---

## J. 全体フロー図（Pod 削除 → 復旧）

```
User                          API Server                Kubelet           Controller
 │                              │                         │                  │
 │ kubectl delete pod           │                         │                  │
 │─────────────────────────────>│                         │                  │
 │                              │                         │                  │
 │                              │  deletionTimestamp をセット               │
 │                              │────────────────────────>│                  │
 │                              │  (Pod は Finalizer で   │   SIGTERM        │
 │                              │   ブロック中)           │──> nginx 終了    │
 │                              │                         │                  │
 │                              │  Pod 変更イベント       │                  │
 │                              │───────────────────────────────────────────>│
 │                              │                         │                  │
 │                              │                         │           ┌─────┤
 │                              │                         │           │27s  │
 │                              │                         │           │sleep│
 │                              │                         │           └─────┤
 │                              │                         │                  │
 │                              │  Pod 再取得             │                  │
 │                              │<───────────────────────────────────────────│
 │                              │                         │                  │
 │                              │  Finalizer を削除       │                  │
 │                              │<───────────────────────────────────────────│
 │                              │                         │                  │
 │                              │  Pod を完全削除         │                  │
 │                              │                         │                  │
 │  Pod 削除イベント            │                         │                  │
 │───────────────────────────────────────────────────────────────────────────│
 │                              │                         │           ┌─────┤
 │                              │                         │           │新Pod│
 │                              │                         │           │作成 │
 │                              │                         │           └─────┤
 │                              │                         │                  │
 │                              │  新Pod 作成リクエスト    │                  │
 │                              │<───────────────────────────────────────────│
 │                              │                         │                  │
 │                              │────────────────────────>│  コンテナ起動     │
 │                              │                         │  nginx Running   │
┌┴─────────────────┐           │                         │                  │
│ 合計約 30s で復旧 │           │                         │                  │
│ Running Pods = 3 │           │                         │                  │
└──────────────────┘           │                         │                  │
```

---

## K. トラブルシューティング

### K-1. CRD の apply が失敗する

```
The CustomResourceDefinition "..." is invalid: metadata.annotations: Too long
```

**原因:** CRD のサイズが 256KB を超えている（`corev1.PodTemplateSpec` をそのまま使った場合）

**解決:**
- `PodTemplateSpec` をやめて独自の `PodTemplate` 構造体を使う（本チュートリアルのアプローチ）
- `kubectl apply --server-side` を使う（annotation 制限を回避）

### K-2. CR の apply が「strict decoding error」で失敗する

```
error: unknown field "spec.template.metadata.labels"
```

**原因:** CRD のスキーマに `metadata.labels` が含まれていない

**解決:** `PodTemplate` 構造体で `ObjectMeta` に `Labels` フィールドを明示的に定義する

### K-3. Controller が起動しない（アドレス使用中）

```
error listening on :8081: listen tcp :8081: bind: address already in use
```

**原因:** 前回の Controller プロセスが生きている

**解決:**
```bash
lsof -ti:8081 | xargs kill -9
```

### K-4. Status 更新が Conflict エラーになる

```
Operation cannot be fulfilled on gameserversets ... the object has been modified
```

**原因:** Reconcile の開始時と Status 更新時の間で GameServerSet の version が変わった

**これは問題ない（controller-runtime が自動リトライする）。**
ログが気になるだけなら無視してよい。

### K-5. Pod の削除が遅延されず即座に消える

**原因1:** Pod に Finalizer が付いていない
- `kubectl get pod <name> -o jsonpath='{.metadata.finalizers}'` で確認
- `buildPod` で Finalizer を付けているか確認

**原因2:** Controller プロセスが動いていない
- ローカル: `ps aux | grep controller` で確認
- Deployment: `kubectl get pod -l control-plane=gss-controller` で確認

### K-6. Pod が何度も作成と削除を繰り返す（無限ループ）

**原因:** Finalizer を削除した後に再度同じ Pod が Reconcile にかかり、再度 Finalizer が追加され、また sleep に入る

**解決（本コードでは対処済み）:** Finalizer がない terminating Pod は処理をスキップする

### K-7. minikube の Docker デーモンが見えない

```bash
eval $(minikube docker-env)
docker images
# → controller:latest が表示されない場合
```

**原因:** シェルを再起動すると docker-env の設定が消える

**解決:** Controller をビルドする前に必ず `eval $(minikube docker-env)` を実行する

---

## L. クリーンアップ

```bash
# GameServerSet を削除（Pod も自動削除）
kubectl delete gameserverset gameserverset-sample

# Controller Deployment を削除
kubectl delete deploy gss-controller
kubectl delete sa gss-controller
kubectl delete clusterrole gss-controller-role
kubectl delete clusterrolebinding gss-controller-rolebinding

# CRD を削除
kubectl delete crd gameserversets.game.game.example.com

# minikube 停止
minikube stop
```

---

## 付録: よく使う kubectl コマンド集

```bash
# 管理下の Pod を確認
kubectl get pod -l game.example.com/gameserverset-name=<CR名>

# Pod の Finalizer を確認
kubectl get pod <name> -o jsonpath='{.metadata.finalizers}'

# Pod の deletionTimestamp を確認
kubectl get pod <name> -o jsonpath='{.metadata.deletionTimestamp}'

# GameServerSet の Status を確認
kubectl get gameserverset -o wide

# Controller のログをリアルタイム表示（Deployment 版）
kubectl logs -f deploy/gss-controller

# Finalizer が原因で削除できない Pod を強制削除
kubectl patch pod <name> -p '{"metadata":{"finalizers":[]}}' --type=merge
```

---

## 付録: このチュートリアルで学べること一覧

| カテゴリ | 学べること |
|---------|-----------|
| Kubernetes API | CRD, Status subresource, PrinterColumns, deletionTimestamp |
| Controller パターン | Reconciliation Loop, Watch/Owns, 冪等性 |
| Finalizer | 削除ブロックの仕組み、追加/確認/削除の実装パターン |
| OwnerReference | 親子関係、ガベージコレクション |
| controller-runtime | Manager, Client, Cache, Leader Election |
| controller-gen | DeepCopy生成, CRD/RBACマニフェスト生成 |
| RBAC | ServiceAccount, ClusterRole, ClusterRoleBinding |
| 運用 | minikube, コンテナイメージビルド, Deployment デプロイ |
| トラブル対応 | 楽観的ロック、CRD サイズ問題、strict decoding error |
