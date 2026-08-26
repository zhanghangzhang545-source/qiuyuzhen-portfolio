#!/bin/sh
cd "$(dirname "$0")"
PORT=8080
echo "正在启动 QIU YU ZHEN 艺术作品集（端口 $PORT）..."

if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT" >/dev/null 2>&1 &
  SERVER_PID=$!
  sleep 1
  (open "http://localhost:$PORT/" 2>/dev/null || xdg-open "http://localhost:$PORT/" 2>/dev/null)
  echo "已启动。按 Ctrl+C 关闭服务器进程 ($SERVER_PID)。"
  wait "$SERVER_PID"
elif command -v python >/dev/null 2>&1; then
  python -m http.server "$PORT" >/dev/null 2>&1 &
  SERVER_PID=$!
  sleep 1
  (open "http://localhost:$PORT/" 2>/dev/null || xdg-open "http://localhost:$PORT/" 2>/dev/null)
  wait "$SERVER_PID"
elif command -v node >/dev/null 2>&1; then
  PORT=5173
  node serve.mjs >/dev/null 2>&1 &
  SERVER_PID=$!
  sleep 1
  (open "http://localhost:$PORT/" 2>/dev/null || xdg-open "http://localhost:$PORT/" 2>/dev/null)
  wait "$SERVER_PID"
else
  echo "未检测到 Python 或 Node。请先安装其中之一后重试："
  echo "  Python: https://www.python.org/downloads/"
  echo "  Node:   https://nodejs.org/"
  exit 1
fi
