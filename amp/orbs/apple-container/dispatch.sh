#!/usr/bin/env bash
# dispatch.sh
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

# "$ORB_IMAGE" is the Amp orb image.

ids=$(container list --all --quiet)
exists() { grep -Fxq "${1-$ORB_ID}" <<<"$ids"; }

# All orbs share the orbnet network, whose subnet pf.conf firewalls. macOS adds
# a network's bridge (bridge100, ...) when its first container starts and
# removes it when its last one stops, but the network keeps the bridge's name.
# Once another network, such as `default` when `container build` starts
# buildkit, gets that name, starting orbnet again deletes that network's
# bridge, or the other way round. So orbnet never stops: the orbnet-hold
# container stays on it, even while every orb is paused.
orbnet() {
	# Both providers may create the network or its hold at the same time.
	container network inspect orbnet >/dev/null 2>&1 ||
		container network create --subnet 10.213.0.0/24 \
			--subnet-v6 fd00:213::/64 orbnet >/dev/null 2>&1 || true
	if ! exists orbnet-hold; then
		container run --detach --cpus 1 --memory 200M \
			--network orbnet --entrypoint sleep \
			--name orbnet-hold "$ORB_IMAGE" infinity >/dev/null 2>&1 || true
	fi
	container start orbnet-hold >/dev/null 2>&1 || true
}

# Succeeds if this Mac has orbnet's gateway, which is gone when its bridge was
# deleted, for example after the hold stopped with a reboot.
has_bridge() {
	local gateway i
	gateway=$(container network inspect orbnet |
		plutil -extract 0.status.ipv4Gateway raw -o - -)
	for i in {1..5}; do
		ifconfig | grep -Fq "inet $gateway " && return
		sleep 1
	done
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
# orbs whose thread is archived. Threads the Amp login can't see (another
# account's, without its API key) are never matched.
delete_archived() {
	local running id archived
	running=$(container list --quiet)
	for id in $(grep '^amp-' <<<"$ids"); do
		grep -Fxq "$id" <<<"$running" && continue
		archived=$(AMP_API_KEY="${AMP_THREADS_API_KEY:-${AMP_API_KEY-}}" \
			amp threads search "id:T-${id#amp-} archived:true" --json 2>/dev/null) || continue
		grep -q '"id"' <<<"$archived" || continue
		echo "deleting $id: its thread is archived"
		# Another provider may delete the same orb at the same time.
		container delete --force "$id" >/dev/null 2>&1 || true
	done
}

case "$ORB_OPERATION" in
	spawn)
		orbnet
		# A new bridge needs orbnet stopped, which means stopping every container
		# on it. Orbs on it have no network without the bridge anyway.
		if ! has_bridge; then
			echo "orbnet lost its bridge; restarting its containers"
			container list --quiet | grep -E '^(amp-|orbnet-hold$)' |
				xargs container stop >/dev/null || true
			container start orbnet-hold >/dev/null
			has_bridge
		fi
		image="$ORB_IMAGE"
		container image inspect "${ORB_SNAPSHOT_ID-}" >/dev/null 2>&1 && image="$ORB_SNAPSHOT_ID"
		if exists; then
			container start "$ORB_ID"
		else
			# Snapshots from `container commit` keep `sleep` as their entrypoint,
			# so set it explicitly instead of passing `sleep infinity` as the command.
			container run --detach --init \
				--platform linux/arm64 --cpus 4 --memory 8G \
				--network orbnet --entrypoint sleep \
				--name "$ORB_ID" "$image" infinity
		fi
		# A bare --env NAME copies the value from the host.
		container exec --detach --env ORB_TOKEN --env AMP_URL \
			"$ORB_ID" amp orb bootstrap
		;;
	pause)
		if exists; then
			container stop "$ORB_ID"
			if [ -n "${ORB_SNAPSHOT_ID-}" ]; then
				container commit "$ORB_ID" "$ORB_SNAPSHOT_ID"
				# The next spawn boots the snapshot, so the stopped orb isn't needed.
				container delete --force "$ORB_ID"
			fi
		fi
		prune_snapshots
		delete_archived
		;;
	delete)
		if exists; then
			container delete --force "$ORB_ID"
		fi
		prune_snapshots
		delete_archived
		;;
	*)
		exit 1
		;;
esac
