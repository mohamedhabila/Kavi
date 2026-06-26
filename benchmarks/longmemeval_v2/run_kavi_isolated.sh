#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_ROOT_VALUE="${OUTPUT_ROOT:-$REPO_ROOT/.private/evals/runs/longmemeval-v2/kavi_memory_isolated}"
DATA_ROOT_VALUE="${DATA_ROOT:-}"
TIER_VALUE="${TIER:-small}"

if [[ $# -lt 2 || "${1:-}" != "--upstream" ]]; then
  echo "Usage: $0 --upstream /path/to/LongMemEval-V2 [extra run args]" >&2
  exit 2
fi

if [[ -z "$DATA_ROOT_VALUE" ]]; then
  echo "DATA_ROOT must point to a prepared LongMemEval-V2 data root." >&2
  exit 2
fi

UPSTREAM="$2"
shift 2

python3 "$SCRIPT_DIR/run_kavi_isolated.py" \
  --upstream "$UPSTREAM" \
  --data-root "$DATA_ROOT_VALUE" \
  --domain web \
  --tier "$TIER_VALUE" \
  --output-dir "$OUTPUT_ROOT_VALUE/kavi_memory_isolated_web_${TIER_VALUE}" \
  "$@"

python3 "$SCRIPT_DIR/run_kavi_isolated.py" \
  --upstream "$UPSTREAM" \
  --data-root "$DATA_ROOT_VALUE" \
  --domain enterprise \
  --tier "$TIER_VALUE" \
  --output-dir "$OUTPUT_ROOT_VALUE/kavi_memory_isolated_enterprise_${TIER_VALUE}" \
  "$@"
