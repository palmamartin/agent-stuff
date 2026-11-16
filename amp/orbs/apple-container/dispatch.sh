#!/usr/bin/env bash
# dispatch.sh
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

# "$ORB_IMAGE" is the Amp orb image.

ids=$(container list --all --quiet)
exists() { grep -Fxq "${1-$ORB_ID}" <<<"$ids"; }

delete_orb() {
	if exists "$1"; then
		container delete --force "$1"
	fi
	if container network inspect "$1" >/dev/null 2>&1; then
		container network delete "$1" >/dev/null
	fi
}

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

# Amp never asks to delete project snapshots, and each `container commit` keeps
# a multi-GB image. Amp reuses a snapshot for at most 72 hours after its chain
# was built from the base image, so delete older snapshot images no orb uses.
prune_snapshots() {
	local cutoff used image created
	cutoff=$(date -u -v-72H +%Y-%m-%dT%H:%M:%SZ)
	used=$(container list --all | awk 'NR > 1 { sub("^docker.io/library/", "", $2); print $2 }')
	for image in $(container image list --quiet | grep '^snap-'); do
		grep -Fxq "$image" <<<"$used" && continue
		created=$(container image inspect "$image" |
			plutil -extract 0.configuration.creationDate raw -o - -) || continue
		# Another provider may delete the same image at the same time.
		if [[ "$created" < "$cutoff" ]]; then
			container image delete "$image" >/dev/null 2>&1 || true
		fi
	done
}

# Amp sends delete only when a thread is deleted, not archived. Delete stopped
# orbs and leftover orb networks whose thread is archived. Threads the Amp login
# can't see (another account's, without its API key) are never matched.
delete_archived() {
	local running id archived
	running=$(container list --quiet)
	for id in $({ echo "$ids"; container network list | awk 'NR > 1 { print $1 }'; } |
		grep '^amp-' | sort -u); do
		grep -Fxq "$id" <<<"$running" && continue
		archived=$(AMP_API_KEY="${AMP_THREADS_API_KEY:-${AMP_API_KEY-}}" \
			amp threads search "id:T-${id#amp-} archived:true" --json 2>/dev/null) || continue
		grep -q '"id"' <<<"$archived" || continue
		echo "deleting $id: its thread is archived"
		# Another provider may delete the same orb at the same time.
		delete_orb "$id" || true
	done
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
		prune_snapshots
		delete_archived
		;;
	delete)
		delete_orb "$ORB_ID"
		prune_snapshots
		delete_archived
		;;
	*)
		exit 1
		;;
esac
