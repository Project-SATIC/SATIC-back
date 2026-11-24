-- Migration 003: aulas por semana no cadastro da turma e curso de Inteligência Artificial
--
-- 1. aulas_semanais: quantas aulas de 50 min a turma tem por semana. Fica no cadastro para a
--    turma continuar sabendo quantas aulas precisa mesmo quando estiver sem horário (pendente),
--    e para a regra "mover não muda o número de aulas" (decisão de 19/11/2026).
--    Turmas existentes são preenchidas contando as aulas do código SIGAA
--    (soma de nº de dias x nº de aulas de cada bloco, ex: "35M34" = 2 x 2 = 4).
-- 2. As disciplinas IART* são do curso de Inteligência Artificial (noturno), mas a oferta importada
--    do SIGAA/Java as trazia como "CC". Sem a correção, a regra de turno do curso as barraria à noite.

ALTER TABLE turma ADD COLUMN aulas_semanais INTEGER;

UPDATE turma t
SET aulas_semanais = sub.total
FROM (
    SELECT id, COALESCE(SUM(length(m[1]) * length(m[3])), 0)::int AS total
    FROM turma
    LEFT JOIN LATERAL regexp_matches(horario_sigaa, '([2-7]+)([MTN])([1-6]+)', 'g') AS m ON TRUE
    GROUP BY id
) sub
WHERE sub.id = t.id AND sub.total > 0;

ALTER TABLE turma
    ADD CONSTRAINT ck_turma_aulas_semanais CHECK (aulas_semanais IS NULL OR aulas_semanais > 0);

UPDATE turma SET cursos_ofertados = 'IA'
WHERE id_disciplina LIKE 'IART%' AND cursos_ofertados = 'CC';
