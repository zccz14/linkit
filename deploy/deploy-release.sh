#!/usr/bin/env bash
set -euo pipefail

tag="${1:?release tag is required}"
archive_url="${2:?archive URL is required}"
checksum_url="${3:?checksum URL is required}"
archive="linkit-x86_64-unknown-linux-gnu.tar.gz"
release_dir="/opt/linkit/releases/$tag"
temporary_dir="$(mktemp -d)"
previous_release="$(readlink -f /opt/linkit/current 2>/dev/null || true)"
bark_apns_key="/etc/linkit/bark-apns-auth-key.p8"
bark_apns_sha256="bcb56e84877f267d9164cc274f83fa87cd21845d24573235255f4ac565de3ac5"

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
install -d -m 0750 /etc/linkit /etc/systemd/system/linkit.service.d
install -d -m 0755 /etc/nginx/snippets
install -m 0644 /dev/stdin /etc/nginx/snippets/linkit-bark.conf <<'NGINX'
location ^~ /api/bark/ {
    access_log off;
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
NGINX
if ! grep -Fq 'include /etc/nginx/snippets/linkit-bark.conf;' /etc/nginx/sites-available/linkit; then
  sed -i '/client_max_body_size 52m;/a\    include /etc/nginx/snippets/linkit-bark.conf;' /etc/nginx/sites-available/linkit
fi
nginx -t
systemctl reload nginx
if [ ! -f "$bark_apns_key" ]; then
  curl --fail --location --retry 5 --retry-all-errors --output "$temporary_dir/bark-apns-auth-key.p8" \
    https://raw.githubusercontent.com/Finb/bark-server/v2.3.5/deploy/AuthKey_LH4T9V5U4R_5U8LBRXG3A.p8
  printf '%s  %s\n' "$bark_apns_sha256" "$temporary_dir/bark-apns-auth-key.p8" | sha256sum --check --status
  install -o root -g linkit -m 0640 "$temporary_dir/bark-apns-auth-key.p8" "$bark_apns_key"
fi
install -m 0644 /dev/stdin /etc/systemd/system/linkit.service.d/bark.conf <<'UNIT'
[Service]
Environment=BARK_APNS_AUTH_KEY_PATH=/etc/linkit/bark-apns-auth-key.p8
Environment=BARK_APNS_KEY_ID=LH4T9V5U4R
Environment=BARK_APNS_TEAM_ID=5U8LBRXG3A
Environment=BARK_APNS_TOPIC=me.fin.bark
UNIT
systemctl daemon-reload
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
