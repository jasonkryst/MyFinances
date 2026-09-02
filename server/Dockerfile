FROM node:24-alpine
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
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && \
    chown -R node:node /app /src
# Secret file on the host must be chmod 644 so this user can read it.
# See DEPLOYMENT.md for the required setup command.
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/index.js"]