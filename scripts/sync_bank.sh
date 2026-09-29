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

# The server is reached over SSM, not ssh — there is no key for it, and the
# deploy goes the same way. SSM carries commands, not files, and a command's
# parameters are far smaller than a dump, so the dump goes via the bucket
# the migrations already use. The instance can read that bucket and cannot
# write to it, which is why the reverse trip has to be done another way.
cat <<'STEPS'

送上去：
  gzip -c DUMP > DUMP.gz
  aws s3 cp DUMP.gz s3://jlpt-migrate-tmp-1780120411/bank.sql.gz

  aws ssm send-command --instance-ids i-0621553f69b7ddba9 \
      --document-name AWS-RunShellScript --parameters 'commands=[
        "docker exec app-postgres-1 pg_dump -U jlpt -d jlpt --data-only --no-owner
             -t exam_papers -t exam_sections -t exam_problems -t exam_items
             -t exam_media -t exam_adjudications > /tmp/bank-before.sql",
        "aws s3 cp s3://jlpt-migrate-tmp-1780120411/bank.sql.gz /tmp/b.gz --only-show-errors",
        "gunzip -f /tmp/b.gz && docker cp /tmp/b app-postgres-1:/tmp/b.sql",
        "docker exec app-postgres-1 psql -U jlpt -d jlpt -c
             \"TRUNCATE exam_papers, exam_adjudications CASCADE\"",
        "docker exec app-postgres-1 psql -U jlpt -d jlpt -f /tmp/b.sql"]'

TRUNCATE ... CASCADE 会连带清掉做题记录、错题和 AI 解析缓存。
前一句先把线上那六张表存成 /tmp/bank-before.sql，是唯一的退路。
STEPS
