FROM node:24-bookworm

ARG GO_VERSION=1.26.3
ARG RUST_VERSION=1.95.0
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
    mingw-w64 \
    nsis \
    pkg-config \
    python3 \
    unzip \
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
  && sh /tmp/rustup-init.sh -y --profile minimal --default-toolchain "${RUST_VERSION}" --target x86_64-pc-windows-gnu \
  && rm /tmp/rustup-init.sh

ENV PATH="/root/.cargo/bin:/usr/local/go/bin:${PATH}" \
  CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER="x86_64-w64-mingw32-gcc" \
  CARGO_TARGET_X86_64_PC_WINDOWS_GNU_AR="x86_64-w64-mingw32-ar" \
  CC_x86_64_pc_windows_gnu="x86_64-w64-mingw32-gcc" \
  CXX_x86_64_pc_windows_gnu="x86_64-w64-mingw32-g++" \
  TAURI_TARGET_TRIPLE="x86_64-pc-windows-gnu"

WORKDIR /workspace

CMD ["/workspace/Build/scripts/docker/build-windows-inside.sh"]
