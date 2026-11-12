#!/usr/bin/env bash
# install.sh [--firewall] <account>...: run start.sh for each account at login,
# and restart it when it exits. Logs go to
# ~/Library/Logs/amp-orb-provider-<account>.log.
#
# --firewall also installs pf.conf as a system firewall anchor (asks for sudo),
# so orbs cannot reach this Mac, its LAN, or its Tailscale network.
set -euo pipefail

firewall=false
if [ "${1-}" = --firewall ]; then
	firewall=true
	shift
fi
$firewall || [ $# -gt 0 ] || {
	echo "usage: install.sh [--firewall] <account>..." >&2
	exit 1
}
dir="$(cd "$(dirname "$0")" && pwd)"

if $firewall; then
	label=computer.der.amp-orbs-pf
	anchor=/etc/pf.anchors/computer.der.amp-orbs
	plist=/Library/LaunchDaemons/$label.plist
	sudo install -m 644 -o root -g wheel "$dir/pf.conf" "$anchor"
	# pfctl -E holds a pf enable reference for good, so pf stays on when other
	# users of pf release theirs. The anchor is reloaded every minute in case
	# pf is reloaded and to pick up new addresses of this Mac.
	sudo tee "$plist" >/dev/null <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$label</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/sh</string>
		<string>-c</string>
		<string>/sbin/pfctl -E 2>&amp;1 | grep -i token; while :; do out=\$(/sbin/pfctl -a com.apple/100.amp-orbs -f $anchor 2>&amp;1) || echo "\$(date): \$out"; sleep 60; done</string>
	</array>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>StandardOutPath</key><string>/var/log/$label.log</string>
	<key>StandardErrorPath</key><string>/var/log/$label.log</string>
</dict>
</plist>
EOF
	sudo chown root:wheel "$plist"
	sudo chmod 644 "$plist"
	sudo launchctl bootout "system/$label" 2>/dev/null || true
	sudo launchctl bootstrap system "$plist"
	echo "$label: started, log /var/log/$label.log"
fi

for account in "$@"; do
	label="computer.der.amp-orb-provider.$account"
	plist="$HOME/Library/LaunchAgents/$label.plist"
	log="$HOME/Library/Logs/amp-orb-provider-$account.log"
	cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$label</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/bash</string>
		<string>$dir/start.sh</string>
		<string>$account</string>
	</array>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>ThrottleInterval</key><integer>30</integer>
	<key>StandardOutPath</key><string>$log</string>
	<key>StandardErrorPath</key><string>$log</string>
</dict>
</plist>
EOF
	launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
	launchctl bootstrap "gui/$(id -u)" "$plist"
	echo "$label: started, log $log"
done
