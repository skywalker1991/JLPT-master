-- Relations are typed by *why* two entries belong together — five kinds:
-- synonym 近义, derivative 同源, confusable 形音易混, antonym 反义,
-- collocation 搭配. How they differ (nuance, register, conditions) is the
-- note, not the type. Older kinds fold in: nuance and formal_casual were
-- near-synonyms told apart by nuance or register; contrast was opposites.

ALTER TABLE atom_relations DROP CONSTRAINT IF EXISTS relations_type_check;

DELETE FROM atom_relations r
USING atom_relations keep
WHERE r.type IN ('nuance', 'formal_casual') AND keep.type = 'synonym'
  AND keep.from_id = r.from_id AND keep.to_id = r.to_id;
DELETE FROM atom_relations r
USING atom_relations keep
WHERE r.type = 'nuance' AND keep.type = 'formal_casual'
  AND keep.from_id = r.from_id AND keep.to_id = r.to_id;
UPDATE atom_relations SET type = 'synonym' WHERE type IN ('nuance', 'formal_casual');

DELETE FROM atom_relations r
USING atom_relations keep
WHERE r.type = 'contrast' AND keep.type = 'antonym'
  AND keep.from_id = r.from_id AND keep.to_id = r.to_id;
UPDATE atom_relations SET type = 'antonym' WHERE type = 'contrast';

ALTER TABLE atom_relations ADD CONSTRAINT relations_type_check
    CHECK (type IN ('synonym', 'derivative', 'confusable', 'antonym', 'collocation'));
