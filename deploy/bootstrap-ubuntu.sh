#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install --yes ca-certificates certbot curl nginx python3-certbot-nginx
id linkit >/dev/null 2>&1 || useradd --system --home-dir /var/lib/linkit --shell /usr/sbin/nologin linkit
install -d -m 0755 /opt/linkit/releases
install -d -o linkit -g linkit -m 0700 /var/lib/linkit
install -d -m 0755 /etc/nginx/snippets

# 8 GiB 根分区上 nginx 访问日志与 journal 都能各自长到几百 MiB；设上限，
# 免得日志把根分区写满后 SQLite 写不了 WAL、所有写请求变成 500。
install -d -m 0755 /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=200M\n' > /etc/systemd/journald.conf.d/linkit-cap.conf
systemctl restart systemd-journald
python3 - <<'PY'
path = "/etc/logrotate.d/nginx"
text = open(path).read()
if "maxsize" not in text:
    text = text.replace("\tdaily\n", "\tdaily\n\tmaxsize 50M\n", 1)
    text = text.replace("\trotate 14\n", "\trotate 3\n", 1)
    open(path, "w").write(text)
PY

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

install -m 0644 /dev/stdin /etc/nginx/snippets/linkit-events.conf <<'NGINX'
location = /api/events {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
NGINX

install -m 0644 /dev/stdin /etc/systemd/system/linkit.service <<'UNIT'
[Unit]
Description=Linkit
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=linkit
Group=linkit
Environment=HOME=/var/lib/linkit
WorkingDirectory=/var/lib/linkit
ExecStart=/opt/linkit/current/linkit
Restart=on-failure
RestartSec=5s
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/linkit

[Install]
WantedBy=multi-user.target
UNIT

install -m 0644 /dev/stdin /etc/nginx/sites-available/linkit <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name linkit.ntnl.io;
    client_max_body_size 52m;
    include /etc/nginx/snippets/linkit-bark.conf;
    include /etc/nginx/snippets/linkit-events.conf;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

ln -sfn /etc/nginx/sites-available/linkit /etc/nginx/sites-enabled/linkit
rm -f /etc/nginx/sites-enabled/default
systemctl daemon-reload
systemctl enable linkit.service
nginx -t
systemctl restart nginx
