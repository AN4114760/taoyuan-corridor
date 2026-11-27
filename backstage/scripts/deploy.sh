#!/usr/bin/env bash
# 部署到雲端：網頁 → Firebase Hosting、伺服器 → Cloud Run（第一次部署的設定見 README「部署到 Firebase」）
#   bash scripts/deploy.sh          （在 backstage 資料夾執行；Windows 請用 Git Bash）
set -euo pipefail
PROJECT=${PROJECT:-taoyuan-corridor}
REGION=${REGION:-asia-east1}
SERVICE=corridor-server

cd "$(dirname "$0")/.."
npm run build
# 只更新程式；PIN、資料掛載、最多 1 台等設定沿用第一次部署時設好的
gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --source .. --quiet
firebase deploy --only hosting,storage --project "$PROJECT"
