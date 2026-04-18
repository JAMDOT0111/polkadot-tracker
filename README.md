# Polkadot 錢包追蹤器

即時追蹤 Polkadot / Kusama 鏈上帳戶餘額、質押資訊、歷史走勢與關聯地址分析。

## 功能

- 帳戶餘額（總計 / 可用 / 鎖定）
- 近期轉帳紀錄（流入 / 流出）
- 質押資訊（bonded / unbonding / 驗證者詳情）
- 歷史餘額走勢圖
- 關聯地址分析（互動次數 / 淨流量）
- Redis 快取（降低 Subscan API 壓力）
- Nginx 反向代理

## 架構

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Browser   │───▶│    Nginx    │───▶│  Frontend   │
│             │    │  :80        │    │  React/Vite │
└─────────────┘    └──────┬──────┘    └─────────────┘
                          │ /api/*
                   ┌──────▼──────┐    ┌─────────────┐
                   │   Backend   │───▶│    Redis    │
                   │  Express    │    │   Cache     │
                   └──────┬──────┘    └─────────────┘
                          │
                   ┌──────▼──────┐
                   │  Subscan    │
                   │  Public API │
                   └─────────────┘
```

## 快速開始

### 前置需求（WSL2）

```bash
# 一鍵安裝 Docker + Node.js
chmod +x scripts/setup-wsl.sh
./scripts/setup-wsl.sh
```

> 若 Docker 是第一次安裝，安裝後需重新開啟終端再執行一次。

### 開發模式（hot reload）

```bash
./scripts/dev.sh
# 或手動：
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

| 服務     | URL                    |
|----------|------------------------|
| 前端     | http://localhost:5173  |
| 後端 API | http://localhost:3001  |

### 正式模式

```bash
./scripts/prod.sh
# 開啟 http://localhost
```

## 環境變數

複製 `.env.example` 為 `.env`：

```bash
cp .env.example .env
```

| 變數              | 說明                              | 必填 |
|-------------------|-----------------------------------|------|
| `SUBSCAN_API_KEY` | Subscan API Key（提高速率限制）   | 否   |
| `REDIS_URL`       | Redis 連線字串                    | 否   |
| `PORT`            | 後端埠號（預設 3001）             | 否   |

## 常用指令

```bash
# 查看 logs
docker compose logs -f

# 查看特定服務
docker compose logs -f backend

# 重啟特定服務
docker compose restart backend

# 停止所有服務
docker compose down

# 停止並清除資料（包含 Redis）
docker compose down -v

# 進入容器 shell
docker compose exec backend sh
docker compose exec redis redis-cli
```

## 專案結構

```
polkadot-tracker/
├── .github/
│   └── workflows/
│       └── ci.yml          # GitHub Actions CI/CD
├── frontend/
│   ├── src/
│   │   ├── api/            # Subscan API 封裝
│   │   ├── hooks/          # useTracker custom hook
│   │   ├── components/     # React 元件
│   │   └── pages/          # 頁面
│   ├── Dockerfile
│   ├── vite.config.js
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   └── subscan.js  # Subscan 代理路由（含快取）
│   │   └── index.js        # Express 入口
│   ├── Dockerfile
│   └── package.json
├── nginx/
│   ├── Dockerfile
│   └── nginx.conf          # 反向代理設定
├── scripts/
│   ├── setup-wsl.sh        # WSL2 環境安裝
│   ├── dev.sh              # 開發模式啟動
│   └── prod.sh             # 正式模式啟動
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
└── README.md
```

## API 端點

後端提供以下代理端點（自動快取 30 秒）：

| 方法 | 路徑                          | 說明           |
|------|-------------------------------|----------------|
| POST | `/api/:network/account`       | 帳戶基本資訊   |
| POST | `/api/:network/transfers`     | 轉帳紀錄       |
| POST | `/api/:network/staking`       | 質押 / 驗證者  |
| POST | `/api/:network/balance-history` | 歷史餘額     |
| GET  | `/health`                     | 健康檢查       |

`:network` 可為 `polkadot` 或 `kusama`

## 取得 Subscan API Key

1. 前往 https://support.subscan.io/#api-key
2. 申請免費 API Key
3. 填入 `.env` 的 `SUBSCAN_API_KEY`

免費額度：30 req/s（無 Key 為 5 req/s）

## License

MIT
