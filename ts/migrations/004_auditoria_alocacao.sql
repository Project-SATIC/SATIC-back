-- Migration 004: auditoria de atualização na tabela alocacao
--
-- Registra o timestamp da última alteração em cada alocação, mantido automaticamente
-- por trigger em qualquer UPDATE (remanejamento individual, lote ou reserva externa).

ALTER TABLE alocacao
    ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION satic_atualizar_alocacao_timestamp()
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
    EXECUTE FUNCTION satic_atualizar_alocacao_timestamp();
