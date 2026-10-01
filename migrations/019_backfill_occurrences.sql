-- Review cards show a sentence the word was met in. Words kept before the
-- sentence was recorded get theirs back from the passages already analysed:
-- every sentence of the owner's analyses in which the word or grammar point
-- was picked out. Re-running adds nothing (unique per word, sentence, form).

INSERT INTO atom_occurrences (id, atom_id, analysis_id, sentence_index, surface, surface_meaning,
                              sentence_text, sentence_translation, created_at)
SELECT gen_random_uuid(), a.id, an.id, (s->>'index')::smallint, v->>'surface',
       COALESCE(NULLIF(v->>'surface_meaning', ''), v->>'meaning'),
       s->>'text', NULLIF(s->>'translation', ''), an.created_at
FROM analyses an
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(an.session_data->'sentences', '[]'::jsonb)) s
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s->'vocab', '[]'::jsonb)) v
JOIN atoms a ON a.user_id = an.user_id AND a.type = 'vocabulary'
            AND a.key = COALESCE(NULLIF(v->>'base', ''), v->>'surface')
WHERE an.user_id IS NOT NULL AND COALESCE(s->>'text', '') <> ''
ON CONFLICT DO NOTHING;

INSERT INTO atom_occurrences (id, atom_id, analysis_id, sentence_index, surface,
                              sentence_text, sentence_translation, created_at)
SELECT gen_random_uuid(), a.id, an.id, (s->>'index')::smallint, NULL,
       s->>'text', NULLIF(s->>'translation', ''), an.created_at
FROM analyses an
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(an.session_data->'sentences', '[]'::jsonb)) s
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s->'grammar', '[]'::jsonb)) g
JOIN atoms a ON a.user_id = an.user_id AND a.type = 'grammar'
            AND a.key = TRIM(TRANSLATE(g->>'pattern', '~～', '〜〜'))
WHERE an.user_id IS NOT NULL AND COALESCE(s->>'text', '') <> ''
ON CONFLICT DO NOTHING;
