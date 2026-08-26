FROM node:20-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/. .
# server/src/sanitizers/index.js re-exports the frontend's sanitizers.js
# and utils.js by relative path (../../../src/...) rather than duplicating
# validation logic. The build context is the repo root specifically so
# this directory is available to copy -- it must land at /src to match
# that relative path from /app/src/sanitizers/index.js.
COPY src /src
COPY server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 4000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/index.js"]