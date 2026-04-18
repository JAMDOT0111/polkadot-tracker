#!/usr/bin/env bash
set -e

echo "=== Polkadot Tracker — WSL2 環境安裝 ==="

# 檢查是否在 WSL2
if ! grep -qi microsoft /proc/version 2>/dev/null; then
  echo "警告：此腳本針對 WSL2 最佳化，其他環境可能需要手動調整"
fi

# 安裝 Docker（若未安裝）
if ! command -v docker &>/dev/null; then
  echo ">>> 安裝 Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  echo ">>> Docker 安裝完成，請重新開啟終端後再次執行此腳本"
  exit 0
fi

# 安裝 Docker Compose plugin（若未安裝）
if ! docker compose version &>/dev/null; then
  echo ">>> 安裝 Docker Compose plugin..."
  DOCKER_CONFIG=${DOCKER_CONFIG:-$HOME/.docker}
  mkdir -p "$DOCKER_CONFIG/cli-plugins"
  curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
    -o "$DOCKER_CONFIG/cli-plugins/docker-compose"
  chmod +x "$DOCKER_CONFIG/cli-plugins/docker-compose"
fi

# 安裝 Node.js 20（若未安裝）
if ! command -v node &>/dev/null; then
  echo ">>> 安裝 Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo ""
echo ">>> 環境版本確認："
docker --version
docker compose version
node --version
npm --version

# 複製 .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo ">>> 已建立 .env（可編輯 SUBSCAN_API_KEY）"
fi

echo ""
echo "=== 安裝完成！接下來執行： ==="
echo ""
echo "  開發模式（Hot Reload）："
echo "    docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build"
echo ""
echo "  正式模式："
echo "    docker compose up --build -d"
echo ""
echo "  開啟瀏覽器：http://localhost"
