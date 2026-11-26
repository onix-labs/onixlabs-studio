# The end-to-end suite's machine: the Linux the CI job runs it on, with a virtual display, so a local
# run opens no window on the developer's screen. `scripts/e2e-docker.mjs` builds and runs it; the
# repository is mounted, not copied, so the image holds only what the suite needs installed.

ARG NODE_VERSION
FROM node:${NODE_VERSION}-bookworm

# - xvfb and xauth: the virtual display Electron draws to (`xvfb-run`), as in CI.
# - The libraries Electron's Chromium loads: GTK, NSS, sound, the GPU buffer manager and the X
#   extensions it asks for.
# - git: the Git plugin and the suites' own repositories; procps: `ps`, which the suites use to find
#   the processes a plugin started; build tools: `electron-rebuild` compiling node-pty.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    xvfb xauth \
    libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxtst6 libxshmfence1 libxkbcommon0 \
    libatk-bridge2.0-0 libdrm2 libcups2 libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 \
    libsecret-1-0 \
    git procps build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /work
