#!/bin/bash

DIR="$(cd "$(dirname "$0")" && pwd)"
WINDOW_IDS_FILE="/tmp/hairpin_terminal_ids"

# 前回開いたターミナルウィンドウを閉じる
if [ -f "$WINDOW_IDS_FILE" ]; then
  while IFS= read -r wid; do
    osascript -e "tell application \"Terminal\" to close (every window whose id is $wid)" 2>/dev/null
  done < "$WINDOW_IDS_FILE"
  rm -f "$WINDOW_IDS_FILE"
fi

# 既存プロセスをクリーンアップ
echo "=== 既存プロセスを停止中... ==="
pkill -f "kubectl port-forward.*hairpin-server" 2>/dev/null
pkill -f "vite" 2>/dev/null
pkill -f "ngrok http" 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
sleep 1

# port-forward をバックグラウンドで起動
kubectl port-forward --address 0.0.0.0 deploy/hairpin-server 3000:3000 > /tmp/portforward.log 2>&1 &
echo "サーバー接続待ち..."
until curl -s http://localhost:3000/api/game/current > /dev/null 2>&1; do
  sleep 1
done
echo "接続確立！"

# ゲーム開始
curl -s -X POST http://localhost:3000/api/game/start > /dev/null
echo "セッション作成完了"

open_terminal() {
  local cmd="$1"
  local wid
  wid=$(osascript -e "tell application \"Terminal\" to do script \"$cmd\"" -e "tell application \"Terminal\" to id of front window")
  echo "$wid" >> "$WINDOW_IDS_FILE"
}

# vite を別ターミナルで起動
open_terminal "cd '$DIR' && npm run dev"
sleep 2

# ngrok を別ターミナルで起動
open_terminal "ngrok http --url=refinance-uncombed-buffer.ngrok-free.dev 5173"
sleep 2

# cloudflared をバックグラウンドで起動
rm -f /tmp/cloudflared.log
cloudflared tunnel --url http://localhost:5173 --logfile /tmp/cloudflared.log 2>/dev/null &
sleep 5

CLOUDFLARE_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/cloudflared.log | head -1)

NGROK_URL="https://refinance-uncombed-buffer.ngrok-free.dev"

if [ -n "$CLOUDFLARE_URL" ]; then
  COMPASS_URL="${CLOUDFLARE_URL}/compass.html"
else
  COMPASS_URL="（cloudflared URL取得失敗）"
fi

# QRを別ターミナルで表示
open_terminal "cd '$DIR' && echo '=== Even G2 接続用 QR ===' && npx evenhub qr --url $NGROK_URL && echo '' && echo '=== compass.html (スマホ用) ===' && echo '$COMPASS_URL' && npx evenhub qr --url '$COMPASS_URL'"

# サーバーログを別ターミナルで表示
open_terminal "kubectl logs -f deployment/hairpin-server"

clear
echo ""
echo "================================================"
echo "  Hairpin Refactor - 起動完了"
echo "================================================"
echo ""
echo "  Even G2:    $NGROK_URL"
echo "  compass:    $COMPASS_URL"
echo "  monitor:    $NGROK_URL/monitor.html"
echo ""
echo "  QR は別ターミナルを確認してください"
echo "================================================"
