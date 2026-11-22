# The install gate's Debian machine (#1546): a clean Debian with every toolchain Studio's plugins drive
# installed first, and nothing of Studio's. `scripts/e2e-install.mjs` builds it, then installs the
# AppImage this branch built into it and runs a full first-run setup against the real plugin index.
#
# The base is pinned to a dated snapshot, so the distribution's own packages only move when this line
# does; the toolchains are pinned in toolchains.env.

FROM debian:trixie-20261104@sha256:9c6e381421d0f48d1b8133e573f33c185ee16cbf505eda9c4a8a4791b25ea8a6

ARG NODE_VERSION
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8

# - The fetch tools toolchains.sh needs.
# - Git, a C/C++ compiler and debugger, and Python with venv and pip: the distribution's own.
# - libicu: what the .NET SDK needs to start.
# - xvfb and xauth: the virtual display Electron draws to, as in CI.
# - The libraries Electron's Chromium loads, as e2e/docker/Dockerfile has (trixie's names).
# - No FUSE: a container cannot mount one, so the AppImage is extracted, as a user without FUSE does.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils unzip zip tar gzip file procps \
    git build-essential gdb python3 python3-venv python3-pip \
    libicu76 \
    xvfb xauth \
    libgtk-3-0t64 libnss3 libasound2t64 libgbm1 libxss1 libxtst6 libxshmfence1 libxkbcommon0 \
    libatk-bridge2.0-0t64 libdrm2 libcups2t64 libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 \
    libsecret-1-0 \
  && rm -rf /var/lib/apt/lists/*

COPY toolchains.sh toolchains.env /usr/local/lib/studio-gate/
RUN NODE_VERSION="${NODE_VERSION}" bash /usr/local/lib/studio-gate/toolchains.sh system

# A user, as Studio is installed and run by one: never root.
RUN useradd --create-home --shell /bin/bash --uid 1000 studio
USER studio
WORKDIR /home/studio
RUN bash /usr/local/lib/studio-gate/toolchains.sh user
