#!/usr/bin/env bash
# dispatch.sh: Amp orb lifecycle jobs (spawn, pause, delete) with rootless Podman.
# Runs as an orb-<account> user, started by `amp orb provider`. Ported from
# ../apple-container/dispatch.sh. See README.md.
set -euo pipefail

backups="$HOME/orb-backups"
repo=/home/user/workspace/repo

exists() { podman container exists "$ORB_ID"; }

# Amp never deletes snapshots and reuses one for at most 72 hours, so delete
# older snapshot images. Without -f, podman refuses images a container or a
# newer snapshot still uses.
prune_snapshots() {
	local id
	for id in $(podman images -q --filter 'reference=localhost/snap-*' --filter until=72h); do
		podman image rm "$id" >/dev/null 2>&1 || true
	done
}

case "$ORB_OPERATION" in
spawn)
	[ -e /run/amp-orbs/firewall-loaded ] || { echo "orb firewall not loaded; refusing to start orbs" >&2; exit 1; }
	case "${ORB_TYPE:-medium}" in
		small) cpus=2 mem=4g ;;
		large) cpus=4 mem=8g ;;
		*)     cpus=4 mem=6g ;;
	esac
	echo "spawn $ORB_ID: type=${ORB_TYPE:-unset} cpus=$cpus mem=$mem snapshot=${ORB_SNAPSHOT_ID:-none}"
	if exists; then
		podman start "$ORB_ID" >/dev/null
	else
		image="$ORB_IMAGE"
		podman image exists "${ORB_SNAPSHOT_ID:-none}" && image="$ORB_SNAPSHOT_ID"
		# --privileged applies only inside the orb user's user namespace; needed for Docker in the orb.
		podman run -d --init --name "$ORB_ID" --label amp.orb=1 --privileged \
			-v /var/lib/docker \
			--cpus "$cpus" --memory "$mem" --memory-swap "$mem" --shm-size 1g \
			--entrypoint sleep "$image" infinity >/dev/null
		# New orb: restore .amp/in/orb-backup/ from an earlier delete once Amp has checked out the repo.
		if [ -s "$backups/$ORB_ID.tar" ]; then
			podman cp "$backups/$ORB_ID.tar" "$ORB_ID":/tmp/orb-backup.tar
			podman exec -d -u user "$ORB_ID" sh -c "until [ -f $repo/.git/index ]; do sleep 5; done; mkdir -p $repo/.amp/in && tar -xf /tmp/orb-backup.tar -C $repo/.amp/in && rm /tmp/orb-backup.tar" >/dev/null
		fi
	fi
	podman exec -d -u root "$ORB_ID" sh -c "$(cat /opt/amp-orbs/orb-dockerd.sh)" >/dev/null
	podman exec -d --env ORB_TOKEN --env AMP_URL "$ORB_ID" amp orb bootstrap >/dev/null
	;;
pause)
	if exists; then
		podman stop -t 10 "$ORB_ID" >/dev/null
		if [ -n "${ORB_SNAPSHOT_ID-}" ]; then
			podman commit -q "$ORB_ID" "$ORB_SNAPSHOT_ID" >/dev/null
			# The next spawn boots the snapshot, so the stopped orb isn't needed.
			podman rm -v "$ORB_ID" >/dev/null
		fi
	fi
	prune_snapshots
	;;
delete)
	if exists; then
		# Like Amp-hosted orbs, keep .amp/in/orb-backup/ (podman cp also works on stopped orbs).
		mkdir -p "$backups"
		podman cp "$ORB_ID":"$repo/.amp/in/orb-backup" - >"$backups/$ORB_ID.tar" 2>/dev/null ||
			rm -f "$backups/$ORB_ID.tar"
		podman rm -f -v -t 10 "$ORB_ID" >/dev/null
	fi
	find "$backups" -name '*.tar' -mtime +30 -delete 2>/dev/null || true
	prune_snapshots
	;;
*)
	echo "unknown ORB_OPERATION: ${ORB_OPERATION-}" >&2
	exit 1
	;;
esac
