#!/bin/bash
# Copy the question bank to production, and nothing else.
#
# Ingest is local work — it needs the booklets, the model, the drafts and
# the re-runs, and this bank was rebuilt six times in an afternoon as the
# extractor improved. Production never re-extracts, so only the result
# crosses.
#
# Only these tables. The same database holds the vocabulary side — atoms,
# their properties, the review schedule, the analysis history — and that is
# learning the user did, not a bank that can be rebuilt from PDFs. A whole-
# database copy would take it with them.
#
# What this does cost: synthesised listening audio and cached AI
# explanations live on exam_items and go when the rows are replaced. Both
# are money to regenerate, neither is data that cannot be.
set -euo pipefail

TABLES="-t exam_papers -t exam_sections -t exam_problems -t exam_items
        -t exam_media -t exam_adjudications"
DUMP=${1:-/tmp/bank.sql}

# Run inside the container: the host's pg_dump is older than the server it
# would be dumping, and refuses.
docker exec -i jlpt-master-postgres-1 \
    pg_dump -U jlpt -d jlpt --data-only --no-owner $TABLES > "$DUMP"

echo "导出 $(du -h "$DUMP" | cut -f1) → $DUMP"
echo
echo "送上去（先备份，再替换那几张表）："
echo "  scp $DUMP <server>:/tmp/"
echo "  ssh <server> 'docker exec -i <pg> pg_dump -U jlpt jlpt --data-only \\"
echo "      $TABLES > /tmp/bank-before.sql'"
echo "  ssh <server> 'docker exec -i <pg> psql -U jlpt -d jlpt -c \\"
echo "      \"TRUNCATE exam_papers, exam_adjudications CASCADE\"'"
echo "  ssh <server> 'docker exec -i <pg> psql -U jlpt -d jlpt < /tmp/bank.sql'"
echo
echo "TRUNCATE exam_papers CASCADE 会连带清掉做题记录和解析缓存——"
echo "这是替换题库的代价，确认过再执行。"
