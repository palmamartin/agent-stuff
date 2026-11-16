#!/usr/bin/env bash
# start.sh <account>: run the orb provider of one Amp account on this Mac.
#
# The account is picked by its orb provider token (aop_live_…), which this
# script reads from the login keychain. Store it once per account with:
#   security add-generic-password -U -s amp-orb-provider -a <account> -w
set -euo pipefail
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

account="${1:?usage: start.sh <account>}"
dir="$(cd "$(dirname "$0")" && pwd)"
token="$(security find-generic-password -s amp-orb-provider -a "$account" -w)"
# Optional Amp API key of the account, so dispatch.sh can see which of its
# threads are archived. Without it, dispatch.sh uses the amp CLI's login.
AMP_THREADS_API_KEY="$(security find-generic-password -s amp-api-key -a "$account" -w 2>/dev/null || true)"
export AMP_THREADS_API_KEY

# At login the container services may not be running yet.
container system status >/dev/null 2>&1 || container system start --enable-kernel-install

export ORB_IMAGE=us-central1-docker.pkg.dev/amp-prod-0/amp-orb/amp-orb-arm64:latest
# While the Mac sleeps, the provider can't claim jobs and orbs are frozen.
# Keep it awake on AC power for as long as the provider (this PID) runs.
caffeinate -s -w $$ &
AMP_ORB_PROVIDER_TOKEN="$token" exec amp orb provider "$dir/dispatch.sh"
