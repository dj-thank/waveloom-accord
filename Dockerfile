FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runtime
ENV NODE_ENV=production \
    KAGARIAI_HOST=0.0.0.0 \
    KAGARIAI_PORT=8787
WORKDIR /app
# npm is required only in the dependency stage. Removing it from the runtime
# image also removes its unused HTTP client dependency and its vulnerability
# surface; the server starts directly with the Node binary.
RUN rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/bin/npm \
    /usr/local/bin/npx
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node client ./client
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8787/readyz || exit 1
CMD ["node", "server/index.js"]
