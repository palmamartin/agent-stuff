#!/usr/bin/env bash
# dispatch.sh
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

# "$ORB_IMAGE" is the Amp orb image.

ids=$(container list --all --quiet)
exists() { grep -Fxq "$ORB_ID" <<<"$ids"; }

# Each orb gets its own vmnet network: containers on different networks cannot
# reach each other. Orb networks use 10.213.<n>.0/24, which pf.conf firewalls.
create_network() {
	container network inspect "$ORB_ID" >/dev/null 2>&1 && return
	local used n
	used=$(container network list | awk '{ print $2 }')
	for n in {1..254}; do
		grep -Fxq "10.213.$n.0/24" <<<"$used" && continue
		# Fails if another spawn took this subnet meanwhile; try the next.
		container network create --subnet "10.213.$n.0/24" \
			--subnet-v6 "fd00:213:0:$n::/64" "$ORB_ID" >/dev/null 2>&1 && return
	done
	echo "no free orb subnet in 10.213.0.0/16" >&2
	return 1
}

case "$ORB_OPERATION" in
	spawn)
		image="$ORB_IMAGE"
		container image inspect "${ORB_SNAPSHOT_ID-}" >/dev/null 2>&1 && image="$ORB_SNAPSHOT_ID"
		if exists; then
			container start "$ORB_ID"
		else
			create_network
			# Snapshots from `container commit` keep `sleep` as their entrypoint,
			# so set it explicitly instead of passing `sleep infinity` as the command.
			container run --detach --init \
				--platform linux/arm64 --cpus 4 --memory 8G \
				--network "$ORB_ID" --entrypoint sleep \
				--name "$ORB_ID" "$image" infinity
		fi
		# A bare --env NAME copies the value from the host.
		container exec --detach --env ORB_TOKEN --env AMP_URL \
			"$ORB_ID" amp orb bootstrap
		;;
	pause)
		if exists; then
			container stop "$ORB_ID"
			[ -z "${ORB_SNAPSHOT_ID-}" ] || container commit "$ORB_ID" "$ORB_SNAPSHOT_ID"
		fi
		;;
	delete)
		if exists; then
			container delete --force "$ORB_ID"
		fi
		if container network inspect "$ORB_ID" >/dev/null 2>&1; then
			container network delete "$ORB_ID" >/dev/null
		fi
		;;
	*)
		exit 1
		;;
esac
