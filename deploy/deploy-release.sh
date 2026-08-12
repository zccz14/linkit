#!/usr/bin/env bash
set -euo pipefail

tag="${1:?release tag is required}"
archive_url="${2:?archive URL is required}"
checksum_url="${3:?checksum URL is required}"
archive="linkit-x86_64-unknown-linux-gnu.tar.gz"
release_dir="/opt/linkit/releases/$tag"
temporary_dir="$(mktemp -d)"
previous_release="$(readlink -f /opt/linkit/current 2>/dev/null || true)"

cleanup() { rm -rf "$temporary_dir"; }
trap cleanup EXIT
curl --fail --location --retry 5 --retry-all-errors --output "$temporary_dir/$archive" "$archive_url"
curl --fail --location --retry 5 --retry-all-errors --output "$temporary_dir/$archive.sha256" "$checksum_url"
cd "$temporary_dir"
sha256sum --check "$archive.sha256"
mkdir package
tar -xzf "$archive" -C package
install -d -m 0755 "$release_dir"
install -m 0755 package/linkit "$release_dir/linkit"
ln -sfn "$release_dir" /opt/linkit/current
systemctl restart linkit.service
for _ in $(seq 1 30); do
  curl --fail --silent http://127.0.0.1:8080/api/health >/dev/null && exit 0
  sleep 2
done
if [ -n "$previous_release" ]; then
  ln -sfn "$previous_release" /opt/linkit/current
  systemctl restart linkit.service
fi
systemctl status linkit.service --no-pager
exit 1

