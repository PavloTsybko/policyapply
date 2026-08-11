#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root_dir"
sh quickstart/init.sh
docker compose -f compose.quickstart.yml up --build --detach --wait --wait-timeout 180
printf '%s\n' 'PolicyApply quickstart is ready at http://127.0.0.1:3000'
