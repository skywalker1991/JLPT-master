-- Whether learners see a paper. The first time the column arrives, only the
-- five latest N1 sittings are left open for the beta; after that, papers are
-- opened and closed by hand from their page, and this leaves them be.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'exam_papers' AND column_name = 'is_open') THEN
        ALTER TABLE exam_papers ADD COLUMN is_open BOOLEAN NOT NULL DEFAULT true;
        UPDATE exam_papers SET is_open = false
        WHERE id NOT IN (
            SELECT id FROM exam_papers WHERE upper(coalesce(level, 'N1')) = 'N1'
            ORDER BY source DESC NULLS LAST LIMIT 5
        );
    END IF;
END $$;
