#!/usr/bin/env bash
set -e
echo ">>> 啟動正式模式..."
docker compose up --build -d
echo ">>> 已啟動，開啟 http://localhost"
docker compose ps
