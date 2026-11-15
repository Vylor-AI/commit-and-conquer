#!/usr/bin/env bash
set -euo pipefail

: "${AWS_ACCESS_KEY_ID:?Missing AWS_ACCESS_KEY_ID}"
: "${AWS_SECRET_ACCESS_KEY:?Missing AWS_SECRET_ACCESS_KEY}"
: "${AWS_DEFAULT_REGION:?Missing AWS_DEFAULT_REGION}"
: "${S3_BUCKET:?Missing S3_BUCKET}"
: "${CLOUDFRONT_DISTRIBUTION_ID:?Missing CLOUDFRONT_DISTRIBUTION_ID}"

BUILD_DIR="${BUILD_DIR:-dist}"
INVALIDATION_PATHS="${INVALIDATION_PATHS:-/*}"

export AWS_PAGER=""

if [ ! -d "$BUILD_DIR" ]; then
  echo "Build directory '$BUILD_DIR' not found."
  exit 1
fi

S3_URI="s3://${S3_BUCKET}"

echo "Syncing '${BUILD_DIR}/' to '${S3_URI}'..."
aws s3 sync "${BUILD_DIR}/" "${S3_URI}" --delete

echo "Creating CloudFront invalidation for paths: ${INVALIDATION_PATHS}"
aws cloudfront create-invalidation \
  --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}" \
  --paths "${INVALIDATION_PATHS}"

echo "Deployment completed successfully."
