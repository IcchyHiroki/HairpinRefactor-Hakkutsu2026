# 動作ガイド

## 前提

- minikube が起動していること
- `kubectl` が minikube に接続できていること

---

## 1. クラスタ全体の起動

```bash
# GameServerSet Controller が動いているか確認
kubectl get deploy gss-controller
# → 1/1 READY

# ゲーム用リソース（Deployment / Service / RBAC / GameServerSet CR）を一括デプロイ
eval $(minikube docker-env)
cd hairpin
docker build -t hairpin-server:latest .
kubectl apply -k deploy/
```

---

## 2. コンポーネント一覧

| リソース | 名前 | 役割 |
|---------|------|------|
| Deployment | `gss-controller` | GameServerSet Controller |
| Deployment | `hairpin-server` | ゲームバックエンド (Hono + WebSocket) |
| Service | `hairpin-server` | NodePort 30300 |
| GameServerSet CR | `hairpin-game` | 5つの Pod を管理 |
| Pod | `hairpin-game-0` ~ `hairpin-game-4` | 目的地 1〜5 に対応 |

---

## 3. ゲーム API の動作確認

```bash
# ポートフォワードで API にアクセス
kubectl port-forward deploy/hairpin-server 3000:3000

# 別ターミナルで:
# ゲーム開始
curl -s -X POST http://localhost:3000/api/game/start
# → sessionId + 5 destinations

# ゲーム状態確認
curl -s http://localhost:3000/api/game/<sessionId>
# → alive/dead 状態

# 走行距離追加（200m → 目的地1がキルされる）
curl -s -X POST http://localhost:3000/api/game/<sessionId>/run \
  -H 'Content-Type: application/json' \
  -d '{"distanceMeters":200}'
# → terminated: [{id:1, name:"東の廃工場"}]
```

---

## 4. K8s 連携の確認

ゲーム進行に対応して K8s Pod が削除される流れ:

```bash
# ゲーム Pod の状態確認
kubectl get pod -l game.example.com/gameserverset-name=hairpin-game -w

# 走行距離を追加 → 該当 Pod が削除される
curl -X POST http://localhost:3000/api/game/<sessionId>/run \
  -H 'Content-Type: application/json' \
  -d '{"distanceMeters":200}'

# Pod が Terminating → GONE → 27秒後に再作成される
# 確認:
kubectl logs deploy/hairpin-server 2>&1 | grep "k8s:"
# → "k8s: delete hairpin-game-0 OK"
```

---

## 5. 遅延削除の確認（GameServerSet Controller）

```bash
# 通常の K8s Pod 削除 + 27秒待機 + 再作成
kubectl delete pod hairpin-game-2
# → Controller が検知 → 27秒待機 → 同名 Pod を再作成

kubectl get pod -l game.example.com/gameserverset-name=hairpin-game -w
# → hairpin-game-2 が Terminating → GONE → Running
```

---

## 6. ローカル開発（minikube なしで動かす場合）

```bash
cd hairpin

# 依存関係インストール
npm install
cd server && npm install && cd ..

# フロントエンド開発サーバー
npm run dev    # → http://localhost:5173

# バックエンドサーバー（別ターミナル）
cd server && npm run dev   # → http://localhost:3000
```

K8s API がない環境では、ゲームサーバーは自動的に in-memory モードにフォールバックする。

---

## 7. monitor.html の使い方

```bash
# 1. ゲームサーバーが 3000 番で動いていることを確認
# 2. ブラウザで開く:
#    http://localhost:3000/monitor.html
#    http://localhost:3000/compass.html

# monitor: ゲームの状態をリアルタイム表示
# compass: GPS/コンパス情報をスマホから送信
```

---

## 8. クリーンアップ

```bash
# ゲーム関連リソースを削除
kubectl delete -k hairpin/deploy/

# 既存のゲーム Pod（finalizer が原因で削除できない場合）
kubectl get pod -l game.example.com/gameserverset-name=hairpin-game -o name \
  | xargs -I{} kubectl patch {} -p '{"metadata":{"finalizers":[]}}' --type=merge
