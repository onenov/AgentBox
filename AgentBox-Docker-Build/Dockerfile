FROM node:24-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    build-essential \
    ffmpeg \
    file \
    git \
    lsof \
    procps \
    python3 \
    python3-pip \
    python3-venv \
    rclone \
    tini \
  && rm -rf /var/lib/apt/lists/*

ENV HOME=/root \
    AGENTBOX_DATA_ROOT=/root/.AgentBox-Data \
    OPENCLAW_HOME=/root \
    NPM_CONFIG_PREFIX=/root/.npm-global \
    HOMEBREW_PREFIX=/home/linuxbrew/.linuxbrew \
    HOMEBREW_NO_ENV_HINTS=1 \
    NODE_COMPILE_CACHE=/var/cache/agentbox/node-compile-cache \
    OPENCLAW_NO_RESPAWN=1 \
    OPENCLAW_GATEWAY_BIND=lan \
    OPENCLAW_GATEWAY_AUTOSTART=1 \
    PATH=/root/.local/bin:/root/.npm-global/bin:/opt/agentbox/bin:$PATH:/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin \
    PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ \
    PIP_TRUSTED_HOST=mirrors.aliyun.com \
    UV_DEFAULT_INDEX=https://mirrors.aliyun.com/pypi/simple/ \
    UV_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ \
    UV_NATIVE_TLS=true \
    AGENTBOX_CONTAINER=1 \
    APP_ENV=production \
    SERVER_HOST=0.0.0.0 \
    SERVER_PORT=8787 \
    DATABASE_URL=file:/root/.AgentBox-Data/agentbox/data.db \
    AUTH_CONFIG_PATH=/root/.AgentBox-Data/agentbox/auth.json \
    HERMES_HOME=/root/.hermes \
    WEBDAV_ROOT=/root/.AgentBox-Data \
    CC_CONNECT_CONFIG=/root/.cc-connect/config.toml \
    CODEX_HOME=/root/.codex \
    CLAUDE_CONFIG_DIR=/root/.claude \
    MODEL_CATALOG_URL=https://agent.orence.net/releases/models.json \
    MODEL_INITIALIZATION_URL=https://agent.orence.net/releases/model-initialization.json \
    NO_PROXY=127.0.0.1,localhost,::1

COPY docker-entrypoint.sh /usr/local/bin/agentbox-entrypoint
COPY brew-root-wrapper.sh /usr/local/bin/brew

RUN chmod 755 /usr/local/bin/agentbox-entrypoint \
  && chmod 755 /usr/local/bin/brew \
  && useradd -m -s /bin/bash linuxbrew \
  && mkdir -p /home/linuxbrew/.linuxbrew \
  && chown -R linuxbrew:linuxbrew /home/linuxbrew/.linuxbrew \
  && su - linuxbrew -c 'git clone --depth=1 https://github.com/Homebrew/brew /home/linuxbrew/.linuxbrew/Homebrew' \
  && mkdir -p /home/linuxbrew/.linuxbrew/bin /home/linuxbrew/.linuxbrew/etc /home/linuxbrew/.linuxbrew/include /home/linuxbrew/.linuxbrew/lib /home/linuxbrew/.linuxbrew/opt /home/linuxbrew/.linuxbrew/sbin /home/linuxbrew/.linuxbrew/share /home/linuxbrew/.linuxbrew/var/homebrew \
  && ln -sf ../Homebrew/bin/brew /home/linuxbrew/.linuxbrew/bin/brew \
  && chown -R linuxbrew:linuxbrew /home/linuxbrew/.linuxbrew \
  && printf '%s\n' \
    'export HOMEBREW_PREFIX=/home/linuxbrew/.linuxbrew' \
    'export HOMEBREW_NO_ENV_HINTS=1' \
    'export AGENTBOX_DATA_ROOT=/root/.AgentBox-Data' \
    'export NODE_COMPILE_CACHE=/var/cache/agentbox/node-compile-cache' \
    'export OPENCLAW_NO_RESPAWN=1' \
    'export OPENCLAW_GATEWAY_BIND=lan' \
    'export OPENCLAW_GATEWAY_AUTOSTART=1' \
    'export PATH=/usr/local/bin:/root/.local/bin:/root/.npm-global/bin:/opt/agentbox/bin:/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:$PATH' \
    > /etc/profile.d/agentbox.sh \
    && mkdir -p /opt/agentbox/bin /root/.AgentBox-Data/agentbox /var/cache/agentbox/node-compile-cache /var/cache/agentbox/root-cache /root/.config/pip \
    && python3 -m pip config --global set global.index-url https://mirrors.aliyun.com/pypi/simple/ \
    && python3 -m pip config --global set global.trusted-host mirrors.aliyun.com \
    && python3 -m pip install --break-system-packages --no-cache-dir uv

WORKDIR /root/.AgentBox-Data

EXPOSE 8787 18789 80

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/agentbox-entrypoint"]
