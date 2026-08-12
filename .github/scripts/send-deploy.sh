#!/usr/bin/env bash
set -euo pipefail

instance_id="${1:?EC2 instance ID is required}"
tag="${2:?release tag is required}"
repository="${GITHUB_REPOSITORY:?GitHub repository is required}"
github_token="${GITHUB_TOKEN:?GitHub token is required}"
archive="linkit-x86_64-unknown-linux-gnu.tar.gz"
release_json="$(mktemp)"
response_headers="$(mktemp)"

cleanup() { rm -f "$release_json" "$response_headers"; }
trap cleanup EXIT

curl --fail --silent --show-error \
  --header "Accept: application/vnd.github+json" \
  --header "Authorization: Bearer $github_token" \
  --output "$release_json" \
  "https://api.github.com/repos/$repository/releases/tags/$tag"

asset_url() {
  local name="$1"
  local id status location count
  count="$(node -e 'const fs=require("fs"); const [name,file]=process.argv.slice(1); process.stdout.write(String(JSON.parse(fs.readFileSync(file)).assets.filter((asset)=>asset.name===name).length))' "$name" "$release_json")"
  if [ "$count" -ne 1 ]; then
    echo "Expected exactly one release asset named '$name'; found $count." >&2
    return 1
  fi
  id="$(node -e 'const fs=require("fs"); const [name,file]=process.argv.slice(1); const asset=JSON.parse(fs.readFileSync(file)).assets.find((entry)=>entry.name===name); process.stdout.write(String(asset.id))' "$name" "$release_json")"
  : > "$response_headers"
  status="$(curl --silent --show-error --request GET --max-redirs 0 \
    --header "Accept: application/octet-stream" \
    --header "Authorization: Bearer $github_token" \
    --dump-header "$response_headers" --output /dev/null --write-out '%{http_code}' \
    "https://api.github.com/repos/$repository/releases/assets/$id")"
  if [ "$status" != 302 ]; then
    echo "GitHub did not return a download redirect for '$name' (HTTP $status)." >&2
    return 1
  fi
  location="$(awk 'tolower(substr($0,1,9)) == "location:" { sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit }' "$response_headers")"
  if [ -z "$location" ]; then
    echo "GitHub returned a redirect without a Location header for '$name'." >&2
    return 1
  fi
  printf '%s' "$location"
}

archive_url="$(asset_url "$archive")"
checksum_url="$(asset_url "$archive.sha256")"
test -n "$archive_url" && test -n "$checksum_url"
script_base64="$(base64 < deploy/deploy-release.sh | tr -d '\n')"
printf -v quoted_tag '%q' "$tag"
printf -v quoted_archive '%q' "$archive_url"
printf -v quoted_checksum '%q' "$checksum_url"
parameters="$(node -e 'const [install,run]=process.argv.slice(1); process.stdout.write(JSON.stringify({commands:[install,run]}))' "printf '%s' '$script_base64' | base64 -d > /tmp/linkit-deploy.sh" "bash /tmp/linkit-deploy.sh $quoted_tag $quoted_archive $quoted_checksum")"
command_id="$(aws ssm send-command --instance-ids "$instance_id" --document-name AWS-RunShellScript --comment "Deploy Linkit $tag" --parameters "$parameters" --query 'Command.CommandId' --output text)"
aws ssm wait command-executed --command-id "$command_id" --instance-id "$instance_id"
aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance_id" --query '{Status:Status,StandardOutput:StandardOutputContent,StandardError:StandardErrorContent}'
