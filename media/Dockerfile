FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3-venv && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/youtube && /opt/youtube/bin/pip install --no-cache-dir "yt-dlp[default]==2026.8.19"
ENV YT_DLP_PATH=/opt/youtube/bin/yt-dlp
WORKDIR /app
COPY scripts/media-adapter.mjs scripts/youtube-import.mjs scripts/
COPY media/container-entry.mjs media/container-entry.mjs
USER node
EXPOSE 8790
ENTRYPOINT ["node", "media/container-entry.mjs"]
