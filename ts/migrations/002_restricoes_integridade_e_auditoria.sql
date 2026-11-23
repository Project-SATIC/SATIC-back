-- Migration 002: Restrições de integridade de domínio, unicidade de alocação e auditoria temporal

-- 1. Remove eventuais alocações duplicadas por turma (mantendo o registro mais recente)
DELETE FROM alocacao a
USING alocacao b
WHERE a.id_turma = b.id_turma
  AND a.id < b.id;

-- 2. Coluna de auditoria temporal em alocacao + trigger de atualização automática
ALTER TABLE alocacao
    ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ;

UPDATE alocacao
SET atualizado_em = COALESCE(data_geracao, CURRENT_TIMESTAMP)
WHERE atualizado_em IS NULL;

ALTER TABLE alocacao
    ALTER COLUMN atualizado_em SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN atualizado_em SET NOT NULL;

CREATE OR REPLACE FUNCTION atualizar_timestamp_alocacao()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_alocacao_atualizado_em ON alocacao;
CREATE TRIGGER trg_alocacao_atualizado_em
    BEFORE UPDATE ON alocacao
    FOR EACH ROW
    EXECUTE FUNCTION atualizar_timestamp_alocacao();

-- 3. Constraints de domínio (CHECK) e unicidade (UNIQUE) aplicadas de forma idempotente
DO $$
BEGIN
    -- sala
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_sala_capacidade_positiva'
          AND connamespace = 'public'::regnamespace
    ) THEN
        ALTER TABLE sala
            ADD CONSTRAINT chk_sala_capacidade_positiva CHECK (capacidade > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_sala_tipo_espaco'
          AND connamespace = 'public'::regnamespace
    ) THEN
        ALTER TABLE sala
            ADD CONSTRAINT chk_sala_tipo_espaco CHECK (tipo_espaco IN ('Sala', 'Laboratório', 'Auditório'));
    END IF;

    -- disciplina
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_disciplina_carga_horaria_positiva'
          AND connamespace = 'public'::regnamespace
    ) THEN
        ALTER TABLE disciplina
            ADD CONSTRAINT chk_disciplina_carga_horaria_positiva CHECK (carga_horaria > 0);
    END IF;

    -- turma
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_turma_vagas_nao_negativas'
          AND connamespace = 'public'::regnamespace
    ) THEN
        ALTER TABLE turma
            ADD CONSTRAINT chk_turma_vagas_nao_negativas CHECK (vagas >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_turma_matriculados_nao_negativos'
          AND connamespace = 'public'::regnamespace
    ) THEN
        ALTER TABLE turma
            ADD CONSTRAINT chk_turma_matriculados_nao_negativos CHECK (matriculados >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_turma_horario_nao_vazio'
          AND connamespace = 'public'::regnamespace
    ) THEN
        ALTER TABLE turma
            ADD CONSTRAINT chk_turma_horario_nao_vazio CHECK (BTRIM(horario_sigaa) <> '');
    END IF;

    -- professor_turma
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_professor_turma_carga_positiva'
          AND connamespace = 'public'::regnamespace
    ) THEN
        ALTER TABLE professor_turma
            ADD CONSTRAINT chk_professor_turma_carga_positiva CHECK (carga_horaria_professor > 0);
    END IF;

    -- restricoes_horario
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_restricoes_horario_nao_vazio'
          AND connamespace = 'public'::regnamespace
    ) THEN
        ALTER TABLE restricoes_horario
            ADD CONSTRAINT chk_restricoes_horario_nao_vazio CHECK (BTRIM(horario_indisponivel) <> '');
    END IF;

    -- alocacao
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_alocacao_status_valido'
          AND connamespace = 'public'::regnamespace
    ) THEN
        ALTER TABLE alocacao
            ADD CONSTRAINT chk_alocacao_status_valido CHECK (status IN ('RASCUNHO', 'DEFINITIVA', 'EXTERNA_FIXA'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_alocacao_horario_nao_vazio'
          AND connamespace = 'public'::regnamespace
    ) THEN
        ALTER TABLE alocacao
            ADD CONSTRAINT chk_alocacao_horario_nao_vazio CHECK (BTRIM(horario_codigo) <> '');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_alocacao_turma'
          AND connamespace = 'public'::regnamespace
    ) THEN
        ALTER TABLE alocacao
            ADD CONSTRAINT uq_alocacao_turma UNIQUE (id_turma);
    END IF;
END $$;

-- O índice único uq_alocacao_turma já indexa alocacao(id_turma), tornando idx_alocacao_turma redundante
DROP INDEX IF EXISTS idx_alocacao_turma;
