#!/usr/bin/env sh
# A.U.R.A easy updater (Linux/macOS/Git Bash).
# Pulls the latest code and auto-stashes any local edits, then reapplies them.
# Your data/ and targets/ folders are git-ignored, so scans and project configs are never touched.
set -e
echo "Updating A.U.R.A (your data/ and targets/ are never modified)..."
git pull --rebase --autostash
echo "Up to date. Restart the server to load changes."
