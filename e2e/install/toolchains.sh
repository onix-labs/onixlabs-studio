#!/usr/bin/env bash
# Installs every toolchain Studio's plugins drive, at pinned versions, on any of the install gate's
# Linux images. The distribution's own packages (Git, a C/C++ compiler, Python) come from each
# Dockerfile; everything whose version would otherwise drift with the distribution is fetched here, the
# same on every image, so Debian and Fedora differ only in what a distribution is meant to differ in.
#
# The toolchains are put where a user who followed each project's own instructions would have them,
# and reach PATH the way theirs would: Node and .NET as commands on the system PATH, Go, the JDK,
# Maven, Gradle and CMake through a profile script, and Rust through rustup's own edit to the user's
# profile. Studio starts from a desktop launcher, not a terminal, so it only finds the second and third
# kind by capturing the login shell's environment — which is exactly what a user's install relies on.
#
#   toolchains.sh system   as root: everything installed machine-wide
#   toolchains.sh user     as the user: rustup into ~/.cargo
#
# A toolchain release cannot break the gate silently: a version moves only when this file changes.

set -euo pipefail

# The pins. NODE_VERSION comes from the repository's .nvmrc, passed in as a build argument.
DOTNET_SDK_VERSION=10.0.404
GO_VERSION=1.27.4
GO_SHA256=7226736c2339719cda28fbf3a54d71aa63bcefe376e98cef00034268dab24840
RUST_VERSION=1.100.0
TEMURIN_RELEASE=jdk-25.0.5.1+2
TEMURIN_ASSET=OpenJDK25U-jdk_x64_linux_hotspot_25.0.5.1_2.tar.gz
TEMURIN_SHA256=760f91b22c3efc9bd1b64ff950598231be82928cc807e30691a0e7a2995a62c0
MAVEN_VERSION=3.9.16
GRADLE_VERSION=9.9.2
CMAKE_VERSION=4.5.1

# Downloads a URL to a file, retrying a flaky connection rather than failing the image on it.
fetch() {
  curl --fail --silent --show-error --location --retry 5 --retry-delay 3 --output "$2" "$1"
}

# Checks a file against an expected SHA-256, and stops the build when it does not match.
verify() {
  echo "$2  $1" | sha256sum --check --strict -
}

system() {
  : "${NODE_VERSION:?NODE_VERSION must be set, from the repository .nvmrc}"
  local work
  work="$(mktemp -d)"
  cd "$work"

  # Node, from nodejs.org, checked against the release's own SHASUMS256.
  local node="node-v${NODE_VERSION}-linux-x64.tar.xz"
  fetch "https://nodejs.org/dist/v${NODE_VERSION}/${node}" "$node"
  fetch "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" SHASUMS256.txt
  grep " ${node}\$" SHASUMS256.txt | sha256sum --check --strict -
  tar -xJf "$node" -C /usr/local --strip-components=1 --no-same-owner

  # The .NET SDK, through Microsoft's install script, which verifies what it fetches. Linked onto the
  # system PATH, as the distribution packages do.
  fetch https://dot.net/v1/dotnet-install.sh dotnet-install.sh
  bash dotnet-install.sh --version "$DOTNET_SDK_VERSION" --install-dir /usr/share/dotnet --no-path
  ln -s /usr/share/dotnet/dotnet /usr/local/bin/dotnet

  # Go, checked against the hash go.dev lists for it, pinned here.
  local go="go${GO_VERSION}.linux-amd64.tar.gz"
  fetch "https://go.dev/dl/${go}" "$go"
  verify "$go" "$GO_SHA256"
  tar -xzf "$go" -C /usr/local

  # The JDK (Eclipse Temurin), Maven and Gradle.
  fetch "https://github.com/adoptium/temurin25-binaries/releases/download/${TEMURIN_RELEASE/+/%2B}/${TEMURIN_ASSET}" jdk.tar.gz
  verify jdk.tar.gz "$TEMURIN_SHA256"
  mkdir -p /opt/jdk && tar -xzf jdk.tar.gz -C /opt/jdk --strip-components=1

  local maven="apache-maven-${MAVEN_VERSION}-bin.tar.gz"
  fetch "https://archive.apache.org/dist/maven/maven-3/${MAVEN_VERSION}/binaries/${maven}" "$maven"
  # Apache publishes SHA-512 rather than SHA-256 for Maven.
  echo "$(curl --fail --silent --location "https://archive.apache.org/dist/maven/maven-3/${MAVEN_VERSION}/binaries/${maven}.sha512" | cut -d' ' -f1)  ${maven}" |
    sha512sum --check --strict -
  mkdir -p /opt/maven && tar -xzf "$maven" -C /opt/maven --strip-components=1

  local gradle="gradle-${GRADLE_VERSION}-bin.zip"
  fetch "https://services.gradle.org/distributions/${gradle}" "$gradle"
  verify "$gradle" "$(curl --fail --silent --location "https://services.gradle.org/distributions/${gradle}.sha256")"
  unzip -q "$gradle" -d /opt && mv "/opt/gradle-${GRADLE_VERSION}" /opt/gradle

  # CMake, from Kitware, checked against its release's SHA-256 list.
  local cmake="cmake-${CMAKE_VERSION}-linux-x86_64.tar.gz"
  fetch "https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/${cmake}" "$cmake"
  fetch "https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/cmake-${CMAKE_VERSION}-SHA-256.txt" cmake.sha256
  grep " ${cmake}\$" cmake.sha256 | sha256sum --check --strict -
  mkdir -p /opt/cmake && tar -xzf "$cmake" -C /opt/cmake --strip-components=1

  # What each project's instructions tell a user to add to their profile.
  cat >/etc/profile.d/toolchains.sh <<'PROFILE'
export JAVA_HOME=/opt/jdk
export DOTNET_ROOT=/usr/share/dotnet
export PATH="/usr/local/go/bin:$HOME/go/bin:$JAVA_HOME/bin:/opt/maven/bin:/opt/gradle/bin:/opt/cmake/bin:$PATH"
PROFILE

  cd /
  rm -rf "$work"
}

user() {
  local work
  work="$(mktemp -d)"
  fetch https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-gnu/rustup-init "$work/rustup-init"
  fetch https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-gnu/rustup-init.sha256 "$work/rustup-init.sha256"
  verify "$work/rustup-init" "$(cut -d' ' -f1 "$work/rustup-init.sha256")"
  chmod +x "$work/rustup-init"
  # rustup edits ~/.profile and ~/.bashrc to source ~/.cargo/env, as it does for every user. rust-src
  # is what rust-analyzer reads the standard library from.
  "$work/rustup-init" -y --profile minimal \
    --default-toolchain "$RUST_VERSION" --component rust-src,rustfmt,clippy
  rm -rf "$work"
}

# Prints what a login shell finds, one toolchain per line, for the run's evidence.
report() {
  local tool
  for tool in 'git --version' 'node --version' 'npm --version' 'dotnet --version' 'go version' \
    'java -version' 'mvn --version' 'gradle --version' 'rustc --version' 'cargo --version' \
    'python3 --version' 'gcc --version' 'g++ --version' 'cmake --version' 'gdb --version'; do
    printf '%-18s %s\n' "${tool%% *}" "$($tool 2>&1 | grep -m1 -E '[0-9]+\.[0-9]+' || echo 'NOT FOUND')"
  done
}

"$@"
