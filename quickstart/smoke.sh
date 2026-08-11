#!/bin/sh
set -eu
set +x

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
state_dir="$root_dir/.quickstart"
secret_dir="$state_dir/secrets"
base_url="http://127.0.0.1:3000/v1/tenants/tenant_quickstart/projects/project_quickstart"
correlation_header="X-Correlation-Id: correlation_quickstart_01"

for tool in curl jq; do
  command -v "$tool" >/dev/null 2>&1 || {
    printf 'Required tool is missing: %s\n' "$tool" >&2
    exit 1
  }
done
for file in creator.header approver.header creator-apply.header; do
  [ -s "$secret_dir/$file" ] || {
    printf '%s\n' 'Run quickstart:init before the smoke test.' >&2
    exit 1
  }
done

curl --silent --show-error --fail \
  --header @"$secret_dir/creator.header" \
  --header "$correlation_header" \
  --header 'Content-Type: application/json' \
  --data '{"actions":[{"id":"action_quickstart_01","type":"example.setting.update","schemaVersion":"1","targetRef":"resource_quickstart_01","parameters":{"enabled":true}}]}' \
  "$base_url/plans" > "$state_dir/plan.json"

plan_id=$(jq -er '.id' "$state_dir/plan.json")
plan_revision=$(jq -er '.revision' "$state_dir/plan.json")
plan_digest=$(jq -er '.digest' "$state_dir/plan.json")
jq -n --argjson revision "$plan_revision" --arg digest "$plan_digest" \
  '{decision:"approved",expectedRevision:$revision,expectedDigest:$digest}' \
  > "$state_dir/decision-request.json"

self_status=$(curl --silent --show-error \
  --output "$state_dir/self-decision.json" --write-out '%{http_code}' \
  --header @"$secret_dir/creator.header" \
  --header "$correlation_header" \
  --header 'Content-Type: application/json' \
  --data @"$state_dir/decision-request.json" \
  "$base_url/plans/$plan_id/decisions")
[ "$self_status" = "409" ]
[ "$(jq -er '.error.code' "$state_dir/self-decision.json")" = "self_approval" ]

curl --silent --show-error --fail \
  --header @"$secret_dir/approver.header" \
  --header "$correlation_header" \
  --header 'Content-Type: application/json' \
  --data @"$state_dir/decision-request.json" \
  "$base_url/plans/$plan_id/decisions" > "$state_dir/approved.json"

jq -n --argjson revision "$plan_revision" --arg digest "$plan_digest" \
  '{planRevision:$revision,planDigest:$digest}' > "$state_dir/apply-request.json"
for attempt in first replay; do
  curl --silent --show-error --fail \
    --header @"$secret_dir/creator-apply.header" \
    --header "$correlation_header" \
    --header 'Content-Type: application/json' \
    --data @"$state_dir/apply-request.json" \
    "$base_url/plans/$plan_id/apply" > "$state_dir/$attempt.json"
done

[ "$(jq -er '.replayed' "$state_dir/first.json")" = "false" ]
[ "$(jq -er '.replayed' "$state_dir/replay.json")" = "true" ]
[ "$(jq -er '.audit.operationId' "$state_dir/first.json")" = \
  "$(jq -er '.audit.operationId' "$state_dir/replay.json")" ]

curl --silent --show-error --fail \
  --header @"$secret_dir/creator.header" \
  --header "$correlation_header" \
  "$base_url/audit" > "$state_dir/audit.json"
[ "$(jq -er '.items | length' "$state_dir/audit.json")" = "1" ]
[ "$(jq -er '.items[0].operationId' "$state_dir/audit.json")" = \
  "$(jq -er '.audit.operationId' "$state_dir/first.json")" ]

curl --silent --show-error --fail \
  --header @"$secret_dir/creator.header" \
  --header "$correlation_header" \
  "$base_url/plans/$plan_id" > "$state_dir/applied-plan.json"
[ "$(jq -er '.status' "$state_dir/applied-plan.json")" = "applied" ]

printf '%s\n' 'Smoke test passed: independent approval, one apply result, replay, and one audit receipt.'
