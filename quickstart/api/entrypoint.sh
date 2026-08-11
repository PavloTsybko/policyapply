#!/bin/sh
set -eu
set +x

runtime_secret_dir=/run/policyapply

for secret_name in runtime_db_password creator_token approver_token; do
  cp "/run/secrets/$secret_name" "$runtime_secret_dir/$secret_name"
done

chmod 700 "$runtime_secret_dir"
chmod 600 "$runtime_secret_dir"/*
chown -R node:node "$runtime_secret_dir"

exec su-exec node:node "$@"
