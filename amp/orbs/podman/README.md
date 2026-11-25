# Self-hosted Amp orbs with rootless Podman

Runs Amp orbs on a Linux server as rootless Podman containers, for one or more Amp accounts (for example `work` and `private`). Each account gets its own unprivileged user, `orb-<account>`, which runs that account's `amp orb provider` as a systemd user service from boot, without a login. Docker works inside every orb.

| File | What it does |
| --- | --- |
| `install.sh [--home DIR] <account>...` | Installs everything below, creates the users, asks for each account's provider token, pulls the orb image and starts the providers. Safe to run again. |
| `dispatch.sh` | Handles Amp's orb lifecycle jobs (`spawn`, `pause`, `delete`) with `podman`. Installed as `/opt/amp-orbs/dispatch.sh`. |
| `orb-dockerd.sh` | Starts Docker inside an orb on every `spawn`. Installed as `/opt/amp-orbs/orb-dockerd.sh`. |
| `amp-orb-provider.service` | systemd user unit that runs `amp orb provider` for an orb user. Installed in `/etc/systemd/user`. |
| `firewall.nft`, `amp-orbs-firewall.service` | Firewall that keeps orbs off this host, its LAN and its Tailscale network (see [Isolation](#isolation)). |
| `amp-orbs [podman args]` | Runs `podman` as every orb user, for example `amp-orbs` to list all orbs or `amp-orbs stats --no-stream`. Installed as `/usr/local/bin/amp-orbs`. |
| `containers.conf` | Podman settings for all rootless users: public DNS, no host mapping, process limit. |

## Requirements

- Debian or Ubuntu with systemd and cgroup v2. Tested on Ubuntu 26.04 (kernel 7.0, Podman 5.7). Ubuntu's AppArmor restriction on unprivileged user namespaces is fine, because the `podman` package ships profiles that allow them.
- x86-64. For ARM64, change `ORB_IMAGE` in `amp-orb-provider.service` and `image` in `install.sh` to the `amp-orb-arm64` image.
- A user with sudo to run `install.sh`.
- Disk space for the orbs: the image alone is 3.9 GB per account. Mount a separate disk at the `--home` directory (default `/srv/orbs`) first if you have one, for example in `/etc/fstab` with `noatime,nodev,nofail`.

## Setup

1. In each Amp account, open Settings → Orbs → Add Provider, name it (for example `exeL01`) and copy the `aop_live_…` token. In the provider's Edit dialog, add the orb types `small`, `medium` and `large` with `medium` as the default, and turn on Idle Orb Cleanup (for example 7 days).
2. Run the installer on the server:

   ```bash
   ./install.sh work private
   ```

   It asks for each account's token at a hidden prompt, so the token stays out of your shell history, and stores it in `/etc/amp-orbs/orb-<account>.env`, readable only by root and that orb user. The first run pulls the orb image for every account, which takes about five minutes each.

Only one provider can run per token, so stop any `amp orb provider` running elsewhere with the same token first. A Mac running [`../apple-container`](../apple-container) needs its own provider in Amp.

The account names are up to you; they only have to match between runs of `install.sh`.

## Orb types

`dispatch.sh` reads the type a thread picked:

| Type | CPUs | Memory |
| --- | --- | --- |
| `small` | 2 | 4 GB |
| `medium` (default, also for unknown types) | 4 | 6 GB |
| `large` | 4 | 8 GB |

These are limits, not reservations. Memory has no swap, so an orb over its limit hits the OOM killer inside the orb.

## Logs and management

All commands as a user with sudo; replace `orb-work` with the account's user.

- Provider log: `sudo journalctl _UID=$(id -u orb-work)`. Every spawn logs its type, CPUs, memory and snapshot.
- Status: `sudo systemctl --user -M orb-work@ status amp-orb-provider`
- Restart: `sudo systemctl --user -M orb-work@ restart amp-orb-provider` (it finishes running jobs first)
- Orbs of all accounts: `amp-orbs` (asks for your sudo password). Any podman command works, for example `amp-orbs stats --no-stream`.
- Change a token: delete `/etc/amp-orbs/orb-work.env`, run `./install.sh work` again, then restart the provider.
- Firewall: `sudo nft list table inet amp_orbs` shows the rules and drop counters.

## Isolation

- Each account has its own user, image store, orbs and snapshots. Root in an orb maps to an unused subuid of that user, not to root on the host, and a work orb can't see or reach the private orbs.
- Each orb gets its own network namespace (pasta), so orbs can't reach each other either.
- No host folders are mounted, no ports are published, and Podman's API socket is not used.
- Orbs run with `--privileged` so Docker works inside them. In rootless Podman that grants all capabilities only inside the orb user's user namespace. It does turn off seccomp, so a kernel bug could let an orb reach its orb user, but not another account or root.
- The firewall drops traffic from every `orb-*` user to this host, private ranges (`10/8`, `172.16/12`, `192.168/16`), Tailscale (`100.64/10`), link-local, multicast and the IPv6 equivalents. It allows DNS only on the resolved stub, for the users' host processes. Because pasta opens every orb connection as the orb user, one rule covers the orbs, the Docker containers inside them, and the provider. Without it, orbs could reach SSH on the host's Tailscale address.
- The firewall loads before any orb user's services start at boot. `dispatch.sh` refuses to start orbs while `/run/amp-orbs/firewall-loaded` is missing.
- Orbs use public DNS (`1.1.1.1`, `9.9.9.9`), so they can't resolve LAN or tailnet names.
- Inside an orb, the host's own addresses are local to the orb (pasta copies them in), so connecting to them reaches the orb itself, not the host.

## Cleanup

Amp sends `delete` only when a thread is deleted or Idle Orb Cleanup removes its orb, and never asks to delete snapshots, so:

- Turn on Idle Orb Cleanup for each provider. Orbs of archived threads stay until it runs.
- Before a `delete`, `dispatch.sh` saves the orb's `.amp/in/orb-backup/` to `~/orb-backups/<orb>.tar` and restores it on the next `spawn` of that orb, as Amp does on hosted orbs. Backups are deleted after 30 days.
- Every `pause` and `delete` deletes snapshot images older than 72 hours that nothing uses. Amp never boots those again.
- Don't run `podman system prune`: a paused orb is a stopped container, and prune deletes it.

## Limitations

- Pausing doesn't keep memory, so processes in the orb stop. Files and Docker images in the orb are kept.
- Snapshots don't include the orb's Docker images (they live on a volume), so a thread that starts from a snapshot pulls or builds them again.
- `docker compose` and `buildx` aren't installed, as on Amp-hosted orbs. Install them from `.agents/setup`.
