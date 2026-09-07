#!/usr/bin/env bash
# Install the Firebase push credential on this server. One command, does
# everything, checks its own work.
#
#   ./scripts/set-firebase-key.sh /path/to/sanaadprd-firebase-adminsdk-xxxx.json
#
# Why this exists: the key was "added and restarted" and the API still could
# not see it. Every way that goes wrong is prevented here -
#   - written to the wrong file           -> always the .env next to docker-compose.yml
#   - quotes or a wrapped line            -> encoded by the script, never pasted
#   - `docker restart` (keeps OLD env)    -> the container is RECREATED
#   - "did it work?" answered by guessing -> /health is asked, and the exit code says
#
# The key never enters the repository: .env is git-ignored and survives every
# `git pull`, so this is run ONCE and every deploy after it just works.
set -euo pipefail

KEY_FILE="${1:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HERE/.env"
CONTAINER="hmc-sanaad-backend"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

[[ -n "$KEY_FILE" ]] || { red "usage: $0 <service-account.json>"; exit 2; }
[[ -f "$KEY_FILE" ]] || { red "no such file: $KEY_FILE"; exit 2; }

# Refuse anything that is not a Firebase service account before touching .env.
PROJECT="$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));assert d["type"]=="service_account";print(d["project_id"])' "$KEY_FILE" 2>/dev/null)" \
  || { red "$KEY_FILE is not a service-account JSON"; exit 2; }
echo "key is for Firebase project: $PROJECT"

VALUE="$(base64 -w0 "$KEY_FILE")"
echo "encoded: ${#VALUE} characters, one line"

# Replace the line if present, append if not. Never leaves two.
touch "$ENV_FILE"
if grep -q '^FIREBASE_SERVICE_ACCOUNT=' "$ENV_FILE"; then
  sed -i "s|^FIREBASE_SERVICE_ACCOUNT=.*|FIREBASE_SERVICE_ACCOUNT=$VALUE|" "$ENV_FILE"
  echo "replaced FIREBASE_SERVICE_ACCOUNT in $ENV_FILE"
else
  printf '\nFIREBASE_SERVICE_ACCOUNT=%s\n' "$VALUE" >> "$ENV_FILE"
  echo "added FIREBASE_SERVICE_ACCOUNT to $ENV_FILE"
fi
chmod 600 "$ENV_FILE"

# A restarted container keeps the environment it was created with. Recreate.
echo "recreating the container (a plain restart would keep the old environment)..."
( cd "$HERE" && docker compose up -d --force-recreate )

# Prove the process sees it, then prove the app accepted it.
SEEN="$(docker exec "$CONTAINER" printenv FIREBASE_SERVICE_ACCOUNT | wc -c)"
[[ "$SEEN" -gt 1 ]] || { red "the container does not see FIREBASE_SERVICE_ACCOUNT"; exit 1; }
echo "container sees $((SEEN - 1)) characters"

PORT="$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2 || true)"
PORT="${PORT:-443}"
echo "waiting for the API..."
for _ in $(seq 1 30); do
  STATUS="$(curl -sk "https://localhost:$PORT/api/v1/health" 2>/dev/null \
    | python3 -c 'import json,sys;print(json.load(sys.stdin).get("push",{}).get("status","?"))' 2>/dev/null || true)"
  [[ "$STATUS" == "ok" || "$STATUS" == "rejected" ]] && break
  sleep 2
done

case "$STATUS" in
  ok)       green "push notifications are live (project $PROJECT)"; exit 0 ;;
  rejected) red "the key arrived but was rejected - is $KEY_FILE the right file?"; exit 1 ;;
  *)        red "API did not report push status (got '$STATUS'). Check: docker logs $CONTAINER"; exit 1 ;;
esac
