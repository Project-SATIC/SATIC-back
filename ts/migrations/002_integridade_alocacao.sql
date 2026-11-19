-- Migration 002: integridade das alocações e dos dados de entrada do motor
--
-- 1. Uma turma ocupa uma única sala física no seu horário (co-docentes dividem a mesma sala),
--    então há no máximo uma alocação por turma. Duplicatas antigas são removidas antes,
--    mantendo a alocação mais recente.
-- 2. status restrito aos valores conhecidos pelo motor e pelo front-end.
-- 3. Valores numéricos coerentes (o validador RN-03 compara demanda com capacidade).

DELETE FROM alocacao a
USING alocacao b
WHERE a.id_turma = b.id_turma
  AND a.id < b.id;

ALTER TABLE alocacao
    ADD CONSTRAINT uq_alocacao_turma UNIQUE (id_turma);

ALTER TABLE alocacao
    ADD CONSTRAINT ck_alocacao_status CHECK (status IN ('RASCUNHO', 'DEFINITIVA', 'EXTERNA_FIXA'));

ALTER TABLE sala
    ADD CONSTRAINT ck_sala_capacidade CHECK (capacidade > 0);

ALTER TABLE disciplina
    ADD CONSTRAINT ck_disciplina_carga_horaria CHECK (carga_horaria > 0);

ALTER TABLE turma
    ADD CONSTRAINT ck_turma_vagas CHECK (vagas >= 0 AND matriculados >= 0);

ALTER TABLE professor_turma
    ADD CONSTRAINT ck_professor_turma_carga CHECK (carga_horaria_professor >= 0);

-- A UNIQUE já cria índice em id_turma; o índice simples da 001 fica redundante
DROP INDEX IF EXISTS idx_alocacao_turma;

CREATE INDEX IF NOT EXISTS idx_alocacao_status ON alocacao(status);
