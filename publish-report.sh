#!/bin/bash
# Pushes the monocart-report/ directory to the gh-pages branch so GitHub Pages
# serves the latest Playwright report at:
#   https://sriniinf9.github.io/reading-badminton-booking/
#
# Called automatically by run-booking.sh after every test run.

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_DIR="$PROJECT_DIR/monocart-report"
LOG="$PROJECT_DIR/booking-cron.log"

if [ ! -f "$REPORT_DIR/index.html" ]; then
  echo "[publish-report] No report found at $REPORT_DIR/index.html — skipping." >> "$LOG"
  exit 0
fi

echo "[publish-report] Publishing monocart report to GitHub Pages…" >> "$LOG"

REMOTE_URL=$(git -C "$PROJECT_DIR" remote get-url origin)
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

# Copy the report into a clean temp directory
cp -r "$REPORT_DIR"/. "$WORK_DIR/"

# Also write a meta redirect at root so bare domain goes to the report
cat > "$WORK_DIR/redirect.html" <<'HTML'
<!DOCTYPE html>
<html><head><meta http-equiv="refresh" content="0; url=index.html"/></head></html>
HTML

# Init a throwaway git repo and force-push to gh-pages
cd "$WORK_DIR"
git init -q
git config user.email "booking-cron@localhost"
git config user.name  "Booking Cron"
git checkout -q -b gh-pages
git add -A
git commit -q -m "Report update $(date '+%Y-%m-%d %H:%M:%S')"
git push -q --force "$REMOTE_URL" gh-pages

echo "[publish-report] Done — https://sriniinf9.github.io/reading-badminton-booking/" >> "$LOG"
