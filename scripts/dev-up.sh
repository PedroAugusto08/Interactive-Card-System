#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_CONTAINER_NAME="acedia-pg"
DB_PORT="5432"
DB_IMAGE="postgres:16"

ensure_env_file() {
  local example_path="$1"
  local env_path="$2"

  if [[ ! -f "$env_path" && -f "$example_path" ]]; then
    cp "$example_path" "$env_path"
    echo "[setup] criado $env_path a partir de $example_path"
  fi
}

start_postgres_if_possible() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "[warn] docker nao encontrado. Inicie o Postgres manualmente em localhost:$DB_PORT."
    return
  fi

  if docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER_NAME}$"; then
    echo "[db] container ${DB_CONTAINER_NAME} ja esta em execucao."
    return
  fi

  if docker ps -a --format '{{.Names}}' | grep -q "^${DB_CONTAINER_NAME}$"; then
    echo "[db] iniciando container existente ${DB_CONTAINER_NAME}..."
    docker start "${DB_CONTAINER_NAME}" >/dev/null
    return
  fi

  echo "[db] criando e iniciando ${DB_CONTAINER_NAME}..."
  docker run \
    --name "${DB_CONTAINER_NAME}" \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=acedia_deck_app \
    -p "${DB_PORT}:5432" \
    -d "${DB_IMAGE}" >/dev/null
}

ensure_env_file "$ROOT_DIR/backend/.env.example" "$ROOT_DIR/backend/.env"
ensure_env_file "$ROOT_DIR/frontend/.env.example" "$ROOT_DIR/frontend/.env"

start_postgres_if_possible

(
  cd "$ROOT_DIR/backend"
  npm run dev
) &

(
  cd "$ROOT_DIR/frontend"
  npm run dev
) &

wait
