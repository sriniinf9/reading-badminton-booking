#!/bin/bash
# Runs the week-ahead badminton booking via pure Python.
# Cron fires at 9:59 PM. The script waits internally until 10:00 PM before grabbing slots.
# If the whole run exits non-zero, this script retries up to MAX_RETRIES times.

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$PROJECT_DIR/booking-cron.log"
PYTHON=/home/sk27/.venv/bin/python3
MAX_RETRIES=3          # total attempts (1 initial + 2 retries)
RETRY_DELAY_SECS=61   # ~1 min between shell-level retries

echo "========================================" >> "$LOG"
echo "Run start: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG"

for attempt in $(seq 1 $MAX_RETRIES); do
  echo "--- Attempt $attempt of $MAX_RETRIES ($(date '+%H:%M:%S')) ---" >> "$LOG"

  cd "$PROJECT_DIR"
  set -a && source .env && set +a
  $PYTHON badminton/book_badminton.py >> "$LOG" 2>&1
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 0 ]; then
    echo "SUCCESS on attempt $attempt at $(date '+%H:%M:%S')" >> "$LOG"
    bash "$PROJECT_DIR/publish-report.sh" || true
    if grep -q "^CONFLUENCE_URL=" "$PROJECT_DIR/.env" 2>/dev/null; then
      node "$PROJECT_DIR/publish-confluence.js" >> "$LOG" 2>&1 || true
    fi
    exit 0
  fi

  echo "Attempt $attempt failed (exit $EXIT_CODE)" >> "$LOG"

  if [ $attempt -lt $MAX_RETRIES ]; then
    echo "Waiting ${RETRY_DELAY_SECS}s before next attempt…" >> "$LOG"
    sleep $RETRY_DELAY_SECS
  fi
done

echo "All $MAX_RETRIES attempts failed. Run end: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG"

# Always publish the report (shows failed result too)
bash "$PROJECT_DIR/publish-report.sh" || true

# Publish summary to Confluence (only if credentials are configured)
if grep -q "^CONFLUENCE_URL=" "$PROJECT_DIR/.env" 2>/dev/null; then
  node "$PROJECT_DIR/publish-confluence.js" >> "$LOG" 2>&1 || true
fi

exit 1
