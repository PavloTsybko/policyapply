#!/bin/sh
set -eu
set +x

source_file="${POLICYAPPLY_RUNTIME_DB_PASSWORD_FILE:?runtime password file is required}"
runtime_secret_dir=/run/policyapply
runtime_secret_file="$runtime_secret_dir/runtime_db_password"

mkdir -p "$runtime_secret_dir"
cp "$source_file" "$runtime_secret_file"
chown -R postgres:postgres "$runtime_secret_dir"
chmod 700 "$runtime_secret_dir"
chmod 600 "$runtime_secret_file"
export POLICYAPPLY_RUNTIME_DB_PASSWORD_FILE="$runtime_secret_file"

exec docker-entrypoint.sh "$@"
