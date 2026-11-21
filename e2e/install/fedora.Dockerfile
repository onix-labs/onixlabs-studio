# The install gate's Fedora machine (#1546): the same as debian.Dockerfile on the other family of
# Linux distribution, so a library or path that only Debian happens to provide cannot hide a failure.
# The toolchains are the same pinned ones, from toolchains.env.

FROM fedora:45

ARG NODE_VERSION
ENV LANG=C.UTF-8

# - The fetch tools toolchains.sh needs.
# - Git, a C/C++ compiler and debugger, and Python with pip (venv is part of Fedora's Python).
# - libicu: what the .NET SDK needs to start.
# - Xvfb, xvfb-run and xauth: the virtual display Electron draws to.
# - The libraries Electron's Chromium loads, under Fedora's names.
# - No FUSE: the AppImage is extracted, as on Debian.
RUN dnf install -y --setopt=install_weak_deps=False \
    ca-certificates curl xz unzip zip tar gzip file procps-ng findutils which \
    git gcc gcc-c++ make gdb python3 python3-pip \
    libicu \
    xorg-x11-server-Xvfb xorg-x11-xauth \
    gtk3 nss alsa-lib mesa-libgbm libXScrnSaver libXtst libxshmfence libxkbcommon at-spi2-atk \
    libdrm cups-libs libXcomposite libXdamage libXrandr pango libsecret \
  && dnf clean all

COPY toolchains.sh toolchains.env /usr/local/lib/studio-gate/
RUN NODE_VERSION="${NODE_VERSION}" bash /usr/local/lib/studio-gate/toolchains.sh system

# A user, as Studio is installed and run by one: never root.
RUN useradd --create-home --shell /bin/bash --uid 1000 studio
USER studio
WORKDIR /home/studio
RUN bash /usr/local/lib/studio-gate/toolchains.sh user
