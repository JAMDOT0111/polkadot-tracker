#!/usr/bin/env bash
set -e
echo ">>> 啟動開發模式（hot reload）..."
docker compose \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  up --build "$@"
