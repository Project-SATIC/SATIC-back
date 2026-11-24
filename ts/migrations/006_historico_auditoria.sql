-- Migration 006: histórico transacional de auditoria (auditoria_log)
--
-- Registra automaticamente todas as criações, atualizações e remoções nas entidades
-- críticas do SATIC (alocacao, sala, turma, professor, disciplina, semestre_publicacao),
-- capturando snapshots JSONB (dados_anteriores e dados_novos), o autor da ação
-- (via current_setting('satic.autor', true), padrão 'sistema') e o request_id
-- (via current_setting('satic.request_id', true)).

CREATE TABLE IF NOT EXISTS auditoria_log (
    id BIGSERIAL PRIMARY KEY,
    entidade VARCHAR(40) NOT NULL,
    entidade_id VARCHAR(60) NOT NULL,
    operacao VARCHAR(30) NOT NULL
        CHECK (operacao IN ('INSERT', 'UPDATE', 'DELETE', 'PUBLICACAO', 'DESPUBLICACAO', 'GERACAO_MOTOR', 'LOTE')),
    autor VARCHAR(120) NOT NULL DEFAULT 'sistema',
    request_id VARCHAR(64),
    dados_anteriores JSONB,
    dados_novos JSONB,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auditoria_entidade ON auditoria_log(entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_criado_em ON auditoria_log(criado_em DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_request_id ON auditoria_log(request_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_autor ON auditoria_log(autor);

CREATE OR REPLACE FUNCTION satic_registrar_auditoria()
RETURNS TRIGGER AS $$
DECLARE
    v_autor VARCHAR(120);
    v_request_id VARCHAR(64);
    v_entidade_id VARCHAR(60);
    v_old JSONB;
    v_new JSONB;
BEGIN
    IF COALESCE(current_setting('satic.skip_audit_trigger', true), '') = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    v_autor := LEFT(COALESCE(NULLIF(current_setting('satic.autor', true), ''), 'sistema'), 120);
    v_request_id := LEFT(NULLIF(current_setting('satic.request_id', true), ''), 64);

    IF TG_OP = 'INSERT' THEN
        v_old := NULL;
        v_new := to_jsonb(NEW);
    ELSIF TG_OP = 'UPDATE' THEN
        v_old := to_jsonb(OLD);
        v_new := to_jsonb(NEW);
        IF v_old = v_new THEN
            RETURN NEW;
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        v_old := to_jsonb(OLD);
        v_new := NULL;
    END IF;

    v_entidade_id := LEFT(COALESCE(
        (COALESCE(v_new, v_old)->>'id'),
        (COALESCE(v_new, v_old)->>'codigo'),
        (COALESCE(v_new, v_old)->>'matricula_siape'),
        (COALESCE(v_new, v_old)->>'semestre'),
        '?'
    ), 60);

    INSERT INTO auditoria_log (entidade, entidade_id, operacao, autor, request_id, dados_anteriores, dados_novos)
    VALUES (TG_TABLE_NAME, v_entidade_id, TG_OP, v_autor, v_request_id, v_old, v_new);

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auditoria_alocacao ON alocacao;
CREATE TRIGGER trg_auditoria_alocacao
    AFTER INSERT OR UPDATE OR DELETE ON alocacao
    FOR EACH ROW EXECUTE FUNCTION satic_registrar_auditoria();

DROP TRIGGER IF EXISTS trg_auditoria_sala ON sala;
CREATE TRIGGER trg_auditoria_sala
    AFTER INSERT OR UPDATE OR DELETE ON sala
    FOR EACH ROW EXECUTE FUNCTION satic_registrar_auditoria();

DROP TRIGGER IF EXISTS trg_auditoria_turma ON turma;
CREATE TRIGGER trg_auditoria_turma
    AFTER INSERT OR UPDATE OR DELETE ON turma
    FOR EACH ROW EXECUTE FUNCTION satic_registrar_auditoria();

DROP TRIGGER IF EXISTS trg_auditoria_professor ON professor;
CREATE TRIGGER trg_auditoria_professor
    AFTER INSERT OR UPDATE OR DELETE ON professor
    FOR EACH ROW EXECUTE FUNCTION satic_registrar_auditoria();

DROP TRIGGER IF EXISTS trg_auditoria_disciplina ON disciplina;
CREATE TRIGGER trg_auditoria_disciplina
    AFTER INSERT OR UPDATE OR DELETE ON disciplina
    FOR EACH ROW EXECUTE FUNCTION satic_registrar_auditoria();

DROP TRIGGER IF EXISTS trg_auditoria_semestre_publicacao ON semestre_publicacao;
CREATE TRIGGER trg_auditoria_semestre_publicacao
    AFTER INSERT OR UPDATE OR DELETE ON semestre_publicacao
    FOR EACH ROW EXECUTE FUNCTION satic_registrar_auditoria();
