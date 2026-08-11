#!/bin/sh
set -eu
set +x

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
secret_dir="$root_dir/.quickstart/secrets"
mkdir -p "$secret_dir"
chmod 700 "$root_dir/.quickstart" "$secret_dir"

generate_secret() {
  target="$1"
  if [ ! -s "$target" ]; then
    umask 077
    openssl rand -hex 32 > "$target"
  fi
  chmod 600 "$target"
}

generate_secret "$secret_dir/postgres_password"
generate_secret "$secret_dir/runtime_db_password"
generate_secret "$secret_dir/creator_token"
generate_secret "$secret_dir/approver_token"
generate_secret "$secret_dir/idempotency_key"

creator_token=$(tr -d '\r\n' < "$secret_dir/creator_token")
approver_token=$(tr -d '\r\n' < "$secret_dir/approver_token")
idempotency_key=$(tr -d '\r\n' < "$secret_dir/idempotency_key")

umask 077
printf 'Authorization: Bearer %s\n' "$creator_token" > "$secret_dir/creator.header"
printf 'Authorization: Bearer %s\n' "$approver_token" > "$secret_dir/approver.header"
printf 'Authorization: Bearer %s\nIdempotency-Key: %s\n' \
  "$creator_token" "$idempotency_key" > "$secret_dir/creator-apply.header"
chmod 600 "$secret_dir/creator.header" "$secret_dir/approver.header" \
  "$secret_dir/creator-apply.header"

unset creator_token approver_token idempotency_key
printf '%s\n' 'Quickstart secrets are ready in the ignored .quickstart directory.'
