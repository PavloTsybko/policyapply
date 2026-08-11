#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root_dir"
docker compose -f compose.quickstart.yml down --volumes --remove-orphans
printf '%s\n' 'Quickstart containers and the disposable database volume were removed.'
