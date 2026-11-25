# Runs as root inside an orb (sh -c), started by dispatch.sh on every spawn.
pgrep -x dockerd >/dev/null && exit 0
# Runtime state from before a pause or snapshot (stale pid files, sockets); its PIDs get reused.
rm -rf /var/run/docker.pid /var/run/docker.sock /run/docker /run/containerd
# Docker-in-Docker on cgroup v2: move the orb's processes out of its root cgroup,
# otherwise inner containers with --memory/--cpus fail ("threaded mode").
c=/sys/fs/cgroup
mkdir -p $c/init
for p in $(cat $c/cgroup.procs); do echo $p > $c/init/cgroup.procs 2>/dev/null || :; done
sed -e 's/ / +/g' -e 's/^/+/' $c/cgroup.controllers > $c/cgroup.subtree_control
# The image's /etc/docker/daemon.json uses the systemd cgroup driver, but the orb has no systemd.
echo '{"exec-opts":["native.cgroupdriver=cgroupfs"]}' > /run/orb-dockerd.json
exec dockerd --config-file /run/orb-dockerd.json >/var/log/dockerd.log 2>&1
