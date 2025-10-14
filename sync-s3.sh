#!/usr/bin/env bash
# Sync local project to S3, respecting .s3ignore rules and invalidate changed files on CloudFront

set -euo pipefail

: "${AWS_CHEBUREKI_BUCKET:?Set AWS_CHEBUREKI_BUCKET like s3://chebureki}"
: "${AWS_CHEBUREKI_DISTRIBUTION_CLOUDFRONT_ID:?Set AWS_CHEBUREKI_DISTRIBUTION_CLOUDFRONT_ID to your CloudFront distribution ID}"
AWS_PROFILE="${AWS_PROFILE:-default}"

echo "🚀 Syncing to $AWS_CHEBUREKI_BUCKET ..."

# Build excludes from .s3ignore (if present)
EXCLUDES=()
if [[ -f ".s3ignore" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" || "$line" =~ ^# ]] && continue
    EXCLUDES+=(--exclude "$line")
  done < ".s3ignore"
fi

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

# 1) DRY RUN to find changes
aws s3 sync . "$AWS_CHEBUREKI_BUCKET" \
  "${EXCLUDES[@]}" \
  --delete \
  --profile "$AWS_PROFILE" \
  --exact-timestamps \
  --dryrun \
  --only-show-errors | tee "$TMP"

# 2) Parse changed local files (uploads/copies) and deleted remote keys
#    - uploads/copies: get the *local* path after "upload:" / "copy:" and before " to s3://"
#    - deletes: get the *remote* key after "s3://bucket/"
mapfile -t UPLOADED <<EOF
$(sed -nE 's#^\(dryrun\) (upload|copy): (.+) to s3://[^/]+/(.+)$#\2#p' "$TMP" | sed -E 's#^\./##')
EOF

mapfile -t DELETED_KEYS <<EOF
$(sed -nE 's#^\(dryrun\) delete: s3://[^/]+/(.+)$#\1#p' "$TMP")
EOF

if [[ ${#UPLOADED[@]} -eq 0 && ${#DELETED_KEYS[@]} -eq 0 ]]; then
  echo "✅ No changes detected. Nothing to invalidate."
  # still do a real sync in case timestamps differed but no content changes desired
  aws s3 sync . "$AWS_CHEBUREKI_BUCKET" "${EXCLUDES[@]}" --delete --profile "$AWS_PROFILE" --exact-timestamps --only-show-errors
  exit 0
fi

echo "🧾 To upload/copy:"
printf '  - %s\n' "${UPLOADED[@]:-}"

echo "🧾 To delete (remote):"
printf '  - %s\n' "${DELETED_KEYS[@]:-}"

# 3) REAL SYNC
aws s3 sync . "$AWS_CHEBUREKI_BUCKET" \
  "${EXCLUDES[@]}" \
  --delete \
  --profile "$AWS_PROFILE" \
  --exact-timestamps \
  --only-show-errors

# 4) Build invalidation paths:
#    - for uploads: prefix the *local* relative path with "/"
#    - for deletes: prefix the *remote* key with "/"
#    - de-dup
declare -A SEEN
PATHS=()

for p in "${UPLOADED[@]}"; do
  [[ -z "$p" ]] && continue
  p="/${p#./}"
  if [[ -z "${SEEN[$p]:-}" ]]; then SEEN[$p]=1; PATHS+=("$p"); fi
done

for k in "${DELETED_KEYS[@]}"; do
  [[ -z "$k" ]] && continue
  p="/$k"
  if [[ -z "${SEEN[$p]:-}" ]]; then SEEN[$p]=1; PATHS+=("$p"); fi
done

# 5) Chunk invalidations to 30 paths per request
chunk_and_invalidate() {
  local -n arr=$1
  local n=${#arr[@]}
  local i=0
  while (( i < n )); do
    local end=$(( i + 30 ))
    (( end > n )) && end=$n
    local slice=("${arr[@]:i:end-i}")
    echo "🚀 Creating CloudFront invalidation for ${#slice[@]} path(s)..."
    aws cloudfront create-invalidation \
      --distribution-id "$AWS_CHEBUREKI_DISTRIBUTION_CLOUDFRONT_ID" \
      --paths "${slice[@]}" \
      --profile "$AWS_PROFILE" >/dev/null
    i=$end
  done
}

if [[ ${#PATHS[@]} -gt 0 ]]; then
  echo "🧹 Invalidation paths:"
  printf '  - %s\n' "${PATHS[@]}"
  chunk_and_invalidate PATHS
  echo "✅ Sync + invalidation completed."
else
  echo "ℹ️ No paths to invalidate."
fi
