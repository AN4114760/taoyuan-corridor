# 雲端部署（Cloud Run）：backstage/server.mjs ＋ 模組四重新計算用的 Python
# 先在 backstage 執行 npm run build 產生 dist，再用 backstage/scripts/deploy.sh 部署（見 backstage/README.md「部署到 Firebase」）
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN python3 -m venv .venv && .venv/bin/pip install --no-cache-dir pyyaml shapely pyproj

COPY config.yaml ./
COPY module4 ./module4
COPY data/module2 ./data/module2
COPY data/module3 ./data/module3
COPY data/outputs/*_severity.geojson data/outputs/*_features.geojson ./data/outputs/
COPY backstage/server.mjs ./backstage/
COPY backstage/dist ./backstage/dist

# 帳號、回饋、照片、計算結果寫到 DATA_DIR（部署時掛載 Cloud Storage），容器重新啟動也不會消失
ENV DATA_DIR=/mnt/data
CMD ["node", "backstage/server.mjs"]
