FROM node:24-bookworm

ARG GO_VERSION=1.26.3
ARG RUST_VERSION=1.95.0
ARG LLVM_MINGW_VERSION=20260519
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    file \
    git \
    libayatana-appindicator3-dev \
    libssl-dev \
    nsis \
    pkg-config \
    python3 \
    unzip \
    xz-utils \
    zip \
  && rm -rf /var/lib/apt/lists/*

RUN case "${TARGETARCH}" in \
      amd64) go_arch="amd64" ;; \
      arm64) go_arch="arm64" ;; \
      *) echo "Unsupported Docker target architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
  && curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${go_arch}.tar.gz" -o /tmp/go.tgz \
  && rm -rf /usr/local/go \
  && tar -C /usr/local -xzf /tmp/go.tgz \
  && rm /tmp/go.tgz

RUN npm install -g pnpm@10.33.4 \
  && curl -fsSL https://sh.rustup.rs -o /tmp/rustup-init.sh \
  && sh /tmp/rustup-init.sh -y --profile minimal --default-toolchain "${RUST_VERSION}" --target aarch64-pc-windows-gnullvm \
  && rm /tmp/rustup-init.sh

RUN case "${TARGETARCH}" in \
      amd64) llvm_mingw_arch="x86_64" ;; \
      arm64) llvm_mingw_arch="aarch64" ;; \
      *) echo "Unsupported Docker target architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
  && archive="llvm-mingw-${LLVM_MINGW_VERSION}-ucrt-ubuntu-22.04-${llvm_mingw_arch}.tar.xz" \
  && curl -fsSL "https://github.com/mstorsjo/llvm-mingw/releases/download/${LLVM_MINGW_VERSION}/${archive}" -o "/tmp/${archive}" \
  && mkdir -p /opt/llvm-mingw \
  && tar -xJf "/tmp/${archive}" -C /opt/llvm-mingw --strip-components=1 \
  && rm "/tmp/${archive}"

ENV PATH="/root/.cargo/bin:/usr/local/go/bin:/opt/llvm-mingw/bin:${PATH}" \
  CARGO_TARGET_AARCH64_PC_WINDOWS_GNULLVM_LINKER="aarch64-w64-mingw32-clang" \
  CARGO_TARGET_AARCH64_PC_WINDOWS_GNULLVM_AR="aarch64-w64-mingw32-ar" \
  CC_aarch64_pc_windows_gnullvm="aarch64-w64-mingw32-clang" \
  CXX_aarch64_pc_windows_gnullvm="aarch64-w64-mingw32-clang++" \
  TAURI_TARGET_TRIPLE="aarch64-pc-windows-gnullvm"

WORKDIR /workspace

CMD ["/workspace/Build/scripts/docker/build-windows-arm64-inside.sh"]
