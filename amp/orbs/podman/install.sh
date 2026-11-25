#!/usr/bin/env bash
# install.sh [--home DIR] <account>...: run self-hosted Amp orbs on this Linux
# host with rootless Podman, one unprivileged user orb-<account> per Amp account.
# Run as a user with sudo. Safe to run again; it keeps existing tokens and images.
set -euo pipefail

home_base=/srv/orbs
if [ "${1-}" = --home ]; then
	home_base=${2:?--home needs a directory}
	shift 2
fi
[ $# -gt 0 ] || {
	echo "usage: install.sh [--home DIR] <account>..." >&2
	exit 1
}
dir="$(cd "$(dirname "$0")" && pwd)"
image=us-central1-docker.pkg.dev/amp-prod-0/amp-orb/amp-orb:latest

# Packages, Podman config, and the root-owned scripts and units.
pkgs="podman crun passt uidmap catatonit nftables curl"
# shellcheck disable=SC2086
dpkg -s $pkgs >/dev/null 2>&1 ||
	sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $pkgs
sudo install -d -m 0755 /etc/containers /etc/amp-orbs /opt/amp-orbs /etc/systemd/user "$home_base"
sudo install -m 0644 "$dir/containers.conf" /etc/containers/containers.conf
sudo install -m 0755 "$dir/dispatch.sh" /opt/amp-orbs/dispatch.sh
sudo install -m 0644 "$dir/orb-dockerd.sh" /opt/amp-orbs/orb-dockerd.sh
sudo install -m 0755 "$dir/amp-orbs" /usr/local/bin/amp-orbs
sudo install -m 0644 "$dir/amp-orb-provider.service" /etc/systemd/user/amp-orb-provider.service
sudo install -m 0644 "$dir/amp-orbs-firewall.service" /etc/systemd/system/amp-orbs-firewall.service

# One system user per account: no login, no groups, its own subuid range.
for account in "$@"; do
	u="orb-$account"
	id "$u" >/dev/null 2>&1 ||
		sudo useradd --system --user-group --home-dir "$home_base/$u" --create-home --shell /usr/sbin/nologin "$u"
	sudo chmod 0700 "$(getent passwd "$u" | cut -d: -f6)"
	if ! grep -q "^$u:" /etc/subuid; then
		# The next free 100000-aligned range above every existing one, at least 200000.
		start=$(awk -F: 'BEGIN { m = 200000 } { if ($2 + $3 > m) m = $2 + $3 } END { print int((m + 99999) / 100000) * 100000 }' /etc/subuid /etc/subgid)
		sudo usermod --add-subuids "$start-$((start + 65535))" --add-subgids "$start-$((start + 65535))" "$u"
	fi
done

# The firewall must be loaded before any orb user's services start.
users=$(getent passwd | awk -F: '$1 ~ /^orb-/ { printf "%s\"%s\"", n++ ? ", " : "", $1 }')
sed "s/@ORB_USERS@/$users/" "$dir/firewall.nft" | sudo tee /etc/amp-orbs/firewall.nft.new >/dev/null
sudo nft -c -f /etc/amp-orbs/firewall.nft.new
sudo mv /etc/amp-orbs/firewall.nft.new /etc/amp-orbs/firewall.nft
sudo systemctl daemon-reload
sudo systemctl enable --quiet amp-orbs-firewall.service
sudo systemctl reload-or-restart amp-orbs-firewall.service
echo "firewall: $(systemctl is-active amp-orbs-firewall.service), users $users"

for account in "$@"; do
	u="orb-$account"
	h=$(getent passwd "$u" | cut -d: -f6)
	uid=$(id -u "$u")
	run() { (cd / && sudo -u "$u" env -i HOME="$h" PATH="$h/.local/bin:/usr/local/bin:/usr/bin:/bin" XDG_RUNTIME_DIR="/run/user/$uid" "$@"); }

	# The provider token, entered at a hidden prompt and readable only by root and this user.
	env="/etc/amp-orbs/$u.env"
	if ! sudo test -s "$env"; then
		read -rsp "Orb provider token for $account (aop_live_…): " token
		echo
		[[ $token == aop_live_* ]] || {
			echo "that is not an orb provider token" >&2
			exit 1
		}
		sudo install -m 0440 -o root -g "$u" /dev/null "$env"
		printf 'AMP_ORB_PROVIDER_TOKEN=%s\n' "$token" | sudo tee "$env" >/dev/null
		unset token
	fi

	# Start the user's manager without a login, and keep it running at boot.
	sudo loginctl enable-linger "$u"
	for _ in $(seq 30); do [ -d "/run/user/$uid" ] && break; sleep 1; done

	run test -x "$h/.local/bin/amp" || run bash -c 'cd ~ && curl -fsSL https://ampcode.com/install.sh | bash' >/dev/null
	# A first spawn that has to pull the image would hit Amp's five-minute limit.
	if ! run podman image exists "$image"; then
		echo "$u: pulling the orb image, this takes several minutes"
		run podman pull -q "$image" >/dev/null
	fi

	sudo systemctl --user -M "$u@" daemon-reload
	sudo systemctl --user -M "$u@" enable --quiet --now amp-orb-provider.service
	echo "$u: provider $(sudo systemctl --user -M "$u@" is-active amp-orb-provider.service), log: sudo journalctl _UID=$uid"
done
