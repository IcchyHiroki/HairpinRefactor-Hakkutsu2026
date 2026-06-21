# Custom Controller の技術特異点

## 普通の Reconcile と何が違うか

### 1. 通常の Reconcile の基本パターン

標準的な K8s Controller（例: ReplicaSet Controller）の Reconciler は以下のループ:

```
Reconcile:
  1. CR/親リソース を取得
  2. 子リソース（Pod）を List
  3. 現在数 < 希望数 → 作成（GenerateName）
  4. 現在数 > 希望数 → 削除
  5. Status 更新
```

- **子リソース作成**: `GenerateName` でランダム名
- **削除**: すぐに削除（即座に API Server が処理）
- **作成単位**: 不足分を一度に全作成
- **Pod を識別する手段**: 命名はランダム、ラベルは全 Pod 同一
- **外部からの Pod 削除**: 即座に検知して補充（不足即補充が原則）

---

### 2. 本 Controller の特異点

#### 特異点①: Finalizer で削除をブロック + 待機

// 通常の Controller:
//   Pod が削除された → 補充
//
// 本 Controller:
//   Pod が削除された → deletionTimestamp を検知
//     → Finalizer があることを確認
//     → SLEEP(27s)  ← ここが特異点
//     → Finalizer を外す
//     → Pod が完全削除される
//     → 次回 Reconcile で補充

**効果**: Pod の削除から復活までを Controller が任意の秒数遅延させる。これにより Deployment/ReplicaSet では不可能な「Pod が減った状態を維持する」挙動を実現。

#### 特異点②: 固定名での Pod 作成（Index Naming）

```go
// 通常:
//   GenerateName: "myapp-" → "myapp-j4kt2"（ランダム）
//
// 本 Controller:
//   Name: "myapp-0", "myapp-1", ... "myapp-4"（固定）
```

**なぜ必要か**: 外部システム（ゲームサーバー）が特定の Pod を識別して削除するために、Pod 名が安定している必要がある。`GenerateName` では Pod 削除→再作成のたびに名前が変わり、外部からの追跡が不可能。

**副作用**: 固定名による作成は、API Server が `AlreadyExists` エラーを返すことで冪等性を担保する。キャッシュ不整合で重複作成しようとしても、古い Pod がまだ存在する場合に安全に失敗する。

#### 特異点③: Pod-Index ラベルによる外部マッピング

```go
labels["game.example.com/pod-index"] = strconv.Itoa(index)
```

各 Pod に `0 〜 replicas-1` の一意なインデックスラベルを付与。このラベルを軸にしてゲームサーバーが以下を実行:

```
ゲーム目的地 ID = 1 → Pod Index = 0 → ラベルで検索 → Pod を特定
ゲーム目的地 ID = 2 → Pod Index = 1 → ラベルで検索 → Pod を特定
...
```

これにより、**「K8s をゲームの状態管理に使う」** という発想を実現。通常の Controller は自己完結的だが、本 Controller は外部システムと連携するための「公開ラベルインターフェース」を持つ。

#### 特異点④: Reconcile 内で 27 秒ブロッキング Sleep

```go
log.Info("Waiting before allowing pod deletion", "delaySeconds", delaySec)
select {
case <-time.After(time.Duration(delaySec) * time.Second):
case <-ctx.Done():
    return ctrl.Result{}, ctx.Err()
}
```

通常の Controller は Reconcile を数ミリ秒で完了させるのが理想。ここでは**27秒ブロックするのが仕様**。これにより:

- Worker 数が 1 の場合、27 秒間他の Reconcile はキュー待機
- Pod が完全に消えるまでの間、Controller が追加の Pod 作成を「意図的に遅延」
- `select` で `ctx.Done()` も待つため、Manager 停止時に graceful shutdown 可能

#### 特異点⑤: 1 Reconcile = 1 Pod 作成（Scale-up を分割）

```go
// 通常:
//   needed := replicas - active
//   for i := 0; i < needed; i++ { Create() }  // 一度に全作成
//
// 本 Controller:
//   needed := replicas - active
//   Create()  // 1つだけ作成
//   // 残りは次の Reconcile イベントで処理
```

**理由**: 固定名 + キャッシュ不整合の組み合わせによる複製防止。1 Reconcile で 1 Pod だけ作成することで:

- `Create("hairpin-game-0")` → API Server が作成
- 次の Reconcile（Pod作成イベント→Owns()発火）: キャッシュに `hairpin-game-0` が存在
- → active=1 なので `hairpin-game-1` を作成
- これを replicas まで繰り返す

各作成の間に API Server の応答とキャッシュ同期が入るため、重複が原理的に発生しない。

#### 特異点⑥: 外部の kubectl delete を「機能」として取り込む設計思想

通常の Controller は「外部から Pod が削除されること」を異常として扱い、即座に修復する。

本 Controller は「外部から Pod が削除されること」を**ゲームの進行イベント**として捉え、削除自体は許可しつつ復活を遅らせる。ゲームサーバーが `kubectl delete pod hairpin-game-0` を実行 → Controller が検知 → 27s 待つ → Pod 復活。

```
ゲーム進行: 走行距離200m → ゲームサーバーが kubectl delete pod
  → Controller「お、Pod が削除されようとしてる。27秒待たせてから消してやろう」
  → 27秒後: Pod 復活
  → ゲームUI「pod が復活した」← K8s API で確認
```

この「外部削除を許容し、遅延を付加して返す」という設計は、通常の Reconcile の「不足即補充」原則とは真逆の思想。

---

## 比較表

| 観点 | 標準 Reconcile（RS/Deployment） | 本 Controller |
|------|-------------------------------|---------------|
| Pod 命名 | `GenerateName`（ランダム） | 固定名 `{name}-{index}` |
| 削除時の挙動 | 即座に補充 | Finalizer でブロック + 27s 待機 → 補充 |
| Pod 識別手段 | なし（全 Pod 同一） | `pod-index` ラベル（0..N-1） |
| 外部削除への態度 | 「異常」→即修復 | 「ゲームイベント」→遅延付き復活 |
| 作成単位 | 不足分を一括作成 | 1 Reconcile = 1 Pod |
| Reconcile 時間 | 数ミリ秒 | 最大 27秒（ブロッキング Sleep） |
| 外部連携 | 自己完結的 | ラベルを公開 → ゲームサーバーが連携 |
| CRD サイズ対策 | 不要（標準型） | 独自 PodTemplate で strict decoding error 回避 + server-side apply で 256KB 制限突破 |

---

## まとめ

この Controller は「K8s が本来持つ即時復旧の原則」をあえて破り、「遅延というビジネス価値」を Controller の設計に組み込んだ点が最大の技術特異点。

- **やったこと**: Finalizer + 固定名 + インデックスラベル + ブロッキング Sleep + 1 Pod/Reconcile
- **価値**: ゲームの「pod が倒れてから復活するまで 27 秒」という要件を K8s の仕組み上で実現
- **通常との差**: 「不足を即座に補充する」を「不足を一定時間放置し、その後補充する」に変更
