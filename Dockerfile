FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# runtime deps: only the canvas binding, pinned to the lockfile's version
FROM node:24-alpine AS deps
WORKDIR /deps
COPY package-lock.json /tmp/
RUN v=$(node -p "require('/tmp/package-lock.json').packages['node_modules/@napi-rs/canvas'].version") \
  && echo '{"private":true,"type":"module"}' > package.json \
  && npm install --omit=dev --no-audit --no-fund "@napi-rs/canvas@$v" \
  && rm -rf package-lock.json /root/.npm

FROM node:24-alpine
ENV NODE_ENV=production PORT=80
WORKDIR /app
COPY --from=deps /deps/package.json ./
COPY --from=deps /deps/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server/index.ts server/og.ts server/preview.ts ./server/
COPY src/lib/wallpaper.ts src/lib/config-url.ts src/lib/output.ts ./src/lib/
# fail the build, not the container, if the prebuilt Skia binary can't load here
RUN node -e "import('@napi-rs/canvas').then((m) => m.createCanvas(2, 2).encodeSync('png'))"
USER node
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
# node is PID 1 and handles SIGTERM itself (no npm wrapper)
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.ts"]
