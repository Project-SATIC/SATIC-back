-- Migration 005: status e metadados de espaços, preferências docentes e publicação de semestre
--
-- 1. sala: persiste status ('Disponível' | 'Manutenção'), pcs, equipamentos e observacao.
--    Salas em manutenção saem do pool do motor de busca e são sinalizadas pelo validador.
-- 2. preferencias_horario: janelas marcadas como 'preferencial' pelo docente na grade.
-- 3. semestre_publicacao: estado de publicação oficial da grade do semestre.

ALTER TABLE sala
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Disponível',
    ADD COLUMN IF NOT EXISTS pcs INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS equipamentos TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    ADD COLUMN IF NOT EXISTS observacao TEXT;

ALTER TABLE sala
    DROP CONSTRAINT IF EXISTS ck_sala_status;

ALTER TABLE sala
    ADD CONSTRAINT ck_sala_status CHECK (status IN ('Disponível', 'Manutenção'));

ALTER TABLE sala
    DROP CONSTRAINT IF EXISTS ck_sala_pcs;

ALTER TABLE sala
    ADD CONSTRAINT ck_sala_pcs CHECK (pcs >= 0);

UPDATE sala
SET pcs = capacidade
WHERE LOWER(tipo_espaco) LIKE 'laborat%' AND pcs = 0;

UPDATE sala
SET observacao = CASE
    WHEN alocavel_ic THEN 'Pool de salas do IC.'
    ELSE 'Fora do pool do IC (CTEC/IF).'
END
WHERE observacao IS NULL;

CREATE TABLE IF NOT EXISTS preferencias_horario (
    id SERIAL PRIMARY KEY,
    matricula_siape VARCHAR(20) NOT NULL,
    horario_preferencial VARCHAR(50) NOT NULL,
    CONSTRAINT fk_preferencias_professor
        FOREIGN KEY (matricula_siape)
        REFERENCES professor(matricula_siape)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT uq_preferencia_professor
        UNIQUE (matricula_siape, horario_preferencial)
);

CREATE INDEX IF NOT EXISTS idx_preferencias_siape ON preferencias_horario(matricula_siape);

CREATE TABLE IF NOT EXISTS semestre_publicacao (
    semestre VARCHAR(10) PRIMARY KEY,
    publicada BOOLEAN NOT NULL DEFAULT FALSE,
    publicado_em TIMESTAMP
);

ALTER TABLE professor
    ADD COLUMN IF NOT EXISTS regime VARCHAR(30),
    ADD COLUMN IF NOT EXISTS carga_max INTEGER;

ALTER TABLE professor
    DROP CONSTRAINT IF EXISTS ck_professor_carga_max;

ALTER TABLE professor
    ADD CONSTRAINT ck_professor_carga_max CHECK (carga_max IS NULL OR carga_max >= 0);

ALTER TABLE turma
    ADD COLUMN IF NOT EXISTS permitir_mudar_formato BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE turma
    ALTER COLUMN horario_sigaa TYPE VARCHAR(120);

ALTER TABLE alocacao
    ALTER COLUMN horario_codigo TYPE VARCHAR(120);


