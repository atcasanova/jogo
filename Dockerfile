# ────────────────────────────────────────────────
# 1) Use a Debian-based Node image (glibc) instead
# ────────────────────────────────────────────────
FROM node:18-bookworm-slim          AS base

# ────────────────────────────────────────────────
# 2) Install Python + build tooling
# ────────────────────────────────────────────────
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
        python3 python3-venv python3-pip build-essential && \
    rm -rf /var/lib/apt/lists/*

# ────────────────────────────────────────────────
# 3) Create a dedicated virtual-env for Python
#    (keeps Node and Python neatly separated)
# ────────────────────────────────────────────────
ENV VENV_DIR=/opt/venv
RUN python3 -m venv "$VENV_DIR"
ENV PATH="$VENV_DIR/bin:$PATH"

# ────────────────────────────────────────────────
# 4) Install Node dependencies first (better caching)
# ────────────────────────────────────────────────
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

# ────────────────────────────────────────────────
# 5) Install Python requirements
# ────────────────────────────────────────────────
COPY game-ai-training/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ────────────────────────────────────────────────
# 6) Copy the rest of the source tree
# ────────────────────────────────────────────────
COPY . .

EXPOSE 3000
CMD ["node", "server/server.js"]

