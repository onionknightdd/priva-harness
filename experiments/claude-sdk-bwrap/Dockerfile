FROM node:24-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66

RUN apt-get -o Acquire::Retries=3 update \
    && apt-get -o Acquire::Retries=3 install -y --no-install-recommends bubblewrap ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/poc
COPY package.json package-lock.json ./
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm ci --registry="$NPM_REGISTRY" --no-audit --no-fund --loglevel=http
COPY worker.mjs sandbox.sh ./
COPY tests ./tests
RUN npm run check
USER node
CMD ["npm", "test"]
