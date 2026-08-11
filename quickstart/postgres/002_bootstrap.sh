#!/bin/sh
set -eu
set +x

password_file="${POLICYAPPLY_RUNTIME_DB_PASSWORD_FILE:?runtime password file is required}"
POLICYAPPLY_RUNTIME_DB_PASSWORD=$(tr -d '\r\n' < "$password_file")
case "$POLICYAPPLY_RUNTIME_DB_PASSWORD" in
  *[!A-Za-z0-9._~-]*|'')
    printf '%s\n' 'Invalid generated runtime database password.' >&2
    exit 1
    ;;
esac
export POLICYAPPLY_RUNTIME_DB_PASSWORD
PGOPTIONS='-c log_min_error_statement=panic'
export PGOPTIONS
psql --set ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --file /opt/policyapply/002_bootstrap.sql
unset POLICYAPPLY_RUNTIME_DB_PASSWORD PGOPTIONS
