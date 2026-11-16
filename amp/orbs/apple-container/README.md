# Self-hosted Amp orbs with Apple container

Runs Amp orbs on this Mac as [Apple container](https://github.com/apple/container) VMs, for one or more Amp accounts (for example `work` and `private`), started automatically at login.

| File | What it does |
| --- | --- |
| `dispatch.sh` | Handles Amp's orb lifecycle jobs (`spawn`, `pause`, `delete`) with the `container` CLI. |
| `start.sh <account>` | Runs `amp orb provider` for one account, using that account's provider token from the Keychain. |
| `install.sh [--firewall] <account>...` | Installs a login item (LaunchAgent) per account that runs `start.sh` and restarts it if it exits. Login Items in System Settings lists it as `amp-orb-provider-<account>`. `--firewall` also installs `pf.conf`. |
| `pf.conf` | Firewall rules that keep orbs off this Mac, its LAN, and its Tailscale network. |

## Requirements

- Apple container installed (`/usr/local/bin/container`).
- The Amp CLI at `~/.local/bin/amp`.

## Setup

1. In each Amp account, get the orb provider token (`aop_live_…`) from Settings → Orbs. Rotating a provider's token shows a new one.
2. Store each token in the login keychain. The command prompts for the token, so it stays out of your shell history:

   ```bash
   security add-generic-password -U -s amp-orb-provider -a work -w
   security add-generic-password -U -s amp-orb-provider -a private -w
   ```

3. Install the firewall and the login items:

   ```bash
   ./install.sh --firewall work private
   ```

   `--firewall` asks for your password, because it installs a system firewall anchor and a LaunchDaemon that loads it at boot (see [Isolation](#isolation)). Leave the flag out to install only the login items.

   The providers start right away and again at every login. Only one provider can run per token, so stop any `amp orb provider` you started by hand first.

The account names are up to you. They only have to match between the Keychain entries and `install.sh`.

## Running by hand

To run one account in the foreground without a login item:

```bash
./start.sh work
```

## Logs and management

- Logs: `~/Library/Logs/amp-orb-provider-<account>.log`
- Status: `launchctl print gui/$(id -u)/computer.der.amp-orb-provider.<account>`
- Restart: `launchctl kickstart -k gui/$(id -u)/computer.der.amp-orb-provider.<account>`
- Uninstall:

  ```bash
  launchctl bootout gui/$(id -u)/computer.der.amp-orb-provider.<account>
  rm ~/Library/LaunchAgents/computer.der.amp-orb-provider.<account>.plist
  rm ~/Library/Application\ Support/computer.der.amp-orb-provider/amp-orb-provider-<account>
  ```

- Change a token: run the `security add-generic-password -U …` command again, then restart that account.

## Isolation

- Each orb is its own VM with 4 CPUs and 8 GB of memory. No host folders are mounted, no ports are published, and no SSH agent is forwarded.
- Each orb gets its own container network, named after the orb ID, with the subnet `10.213.<n>.0/24` (IPv6 `fd00:213:0:<n>::/64`). Orbs can't reach each other or containers on other networks. The network is deleted along with the orb.
- Without the firewall, orbs can reach the Mac itself (through their gateway or the Mac's LAN address), the local network, and every device on the Mac's Tailscale network, which sees them as this Mac. Any service on the Mac that listens on all interfaces is open to them.
- The firewall (`install.sh --firewall`) blocks that. It allows orb networks only DNS on their gateway and the public internet, and drops their traffic to this Mac, private ranges (`10/8`, `172.16/12`, `192.168/16`), Tailscale (`100.64/10`), link-local, multicast, and the IPv6 equivalents. It only matches orb subnets, so other containers keep their access.
- Orb containers created before per-orb networks stay on the shared `default` network, unfirewalled, until they're deleted.

### Firewall details

`install.sh --firewall` copies `pf.conf` to `/etc/pf.anchors/computer.der.amp-orbs` and installs the LaunchDaemon `computer.der.amp-orbs-pf`, which runs `/Library/Application Support/computer.der.amp-orbs/amp-orbs-firewall` and shows up in Login Items as `amp-orbs-firewall`. Keep it switched on there, or orbs lose the firewall. At boot it enables pf and keeps an enable reference, so pf stays on when other users of pf (such as Internet Sharing) turn it off. Every minute it reloads the rules into the `com.apple/100.amp-orbs` anchor, so they come back if pf is reloaded.

- Check the loaded rules: `sudo pfctl -a com.apple/100.amp-orbs -s rules`
- Log (pf enable token and reload errors): `/var/log/computer.der.amp-orbs-pf.log`
- After changing `pf.conf`, run `./install.sh --firewall` again.
- Uninstall:

  ```bash
  sudo launchctl bootout system/computer.der.amp-orbs-pf
  sudo rm /Library/LaunchDaemons/computer.der.amp-orbs-pf.plist /etc/pf.anchors/computer.der.amp-orbs
  sudo rm -r /Library/Application\ Support/computer.der.amp-orbs
  sudo pfctl -a com.apple/100.amp-orbs -F rules
  ```

If your own networks use `10.213.0.0/16`, change the range in both `dispatch.sh` and `pf.conf`.

## Limitations

- Providers start at login, not at boot. Apple container only runs in a logged-in user session. To start at boot, enable automatic login, which FileVault doesn't allow.
- While the Mac sleeps, providers can't take jobs and orbs are frozen, so threads wait or their orbs fail to start. `start.sh` keeps the Mac awake while a provider runs, but only on AC power. On battery, or with the lid closed and no external display, the Mac still sleeps.
- Pausing an orb into a snapshot runs `container commit`, which writes the orb's whole filesystem (several GB) as a new image and takes a minute or more. Amp never asks to delete snapshots, so `dispatch.sh` deletes snapshot images older than 72 hours that no orb container uses, on every `pause` and `delete` job. Amp reuses a snapshot for at most 72 hours after its chain was built from the base image, so it never boots one of those again. Check disk usage with `container system df`.
- A paused orb keeps its stopped container and its network, and each network keeps a small helper process running until the orb is deleted.
