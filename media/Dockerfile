FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY scripts/media-adapter.mjs scripts/media-adapter.mjs
COPY media/container-entry.mjs media/container-entry.mjs
USER node
EXPOSE 8790
ENTRYPOINT ["node", "media/container-entry.mjs"]
