-- Migration 001: Schema Inicial do SATIC
-- Baseado no Modelo Lógico do Sistema (7 tabelas)

-- 1. Espaços Físicos / Salas
CREATE TABLE IF NOT EXISTS sala (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL UNIQUE,
    capacidade INTEGER NOT NULL,
    tipo_espaco VARCHAR(50) NOT NULL DEFAULT 'Sala',
    alocavel_ic BOOLEAN NOT NULL DEFAULT TRUE,
    bloco VARCHAR(50) NOT NULL DEFAULT 'IC'
);

-- 2. Professores
CREATE TABLE IF NOT EXISTS professor (
    matricula_siape VARCHAR(20) PRIMARY KEY,
    nome VARCHAR(255) NOT NULL
);

-- 3. Restrições de Horário dos Docentes (RN-02)
CREATE TABLE IF NOT EXISTS restricoes_horario (
    matricula_siape VARCHAR(20) NOT NULL REFERENCES professor(matricula_siape) ON DELETE CASCADE,
    horario_indisponivel VARCHAR(50) NOT NULL,
    PRIMARY KEY (matricula_siape, horario_indisponivel)
);

-- 4. Disciplinas
CREATE TABLE IF NOT EXISTS disciplina (
    codigo VARCHAR(20) PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    carga_horaria INTEGER NOT NULL,
    exige_laboratorio BOOLEAN NOT NULL DEFAULT FALSE
);

-- 5. Turmas Ofertadas
CREATE TABLE IF NOT EXISTS turma (
    id SERIAL PRIMARY KEY,
    id_disciplina VARCHAR(20) NOT NULL REFERENCES disciplina(codigo) ON DELETE RESTRICT,
    codigo_turma VARCHAR(10) NOT NULL,
    semestre VARCHAR(10) NOT NULL,
    cursos_ofertados VARCHAR(100) NOT NULL,
    vagas INTEGER NOT NULL,
    matriculados INTEGER NOT NULL DEFAULT 0,
    requer_alocacao_ic BOOLEAN NOT NULL DEFAULT TRUE,
    horario_sigaa VARCHAR(50) NOT NULL,
    CONSTRAINT uq_turma_semestre_disc_cod UNIQUE (semestre, id_disciplina, codigo_turma)
);

-- 6. Associação Docente <-> Turma (Co-docência / N:M)
CREATE TABLE IF NOT EXISTS professor_turma (
    matricula_siape VARCHAR(20) NOT NULL REFERENCES professor(matricula_siape) ON DELETE RESTRICT,
    id_turma INTEGER NOT NULL REFERENCES turma(id) ON DELETE CASCADE,
    carga_horaria_professor INTEGER NOT NULL DEFAULT 60,
    PRIMARY KEY (matricula_siape, id_turma)
);

-- 7. Alocações Físicas
CREATE TABLE IF NOT EXISTS alocacao (
    id SERIAL PRIMARY KEY,
    id_turma INTEGER NOT NULL REFERENCES turma(id) ON DELETE CASCADE,
    id_sala INTEGER NOT NULL REFERENCES sala(id) ON DELETE RESTRICT,
    horario_codigo VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'RASCUNHO',
    data_geracao TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Índices para otimização de FKs e buscas frequentes
CREATE INDEX IF NOT EXISTS idx_turma_disciplina ON turma(id_disciplina);
CREATE INDEX IF NOT EXISTS idx_turma_semestre ON turma(semestre);
CREATE INDEX IF NOT EXISTS idx_alocacao_turma ON alocacao(id_turma);
CREATE INDEX IF NOT EXISTS idx_alocacao_sala ON alocacao(id_sala);
CREATE INDEX IF NOT EXISTS idx_alocacao_horario ON alocacao(horario_codigo);
CREATE INDEX IF NOT EXISTS idx_professor_turma_turma ON professor_turma(id_turma);
CREATE INDEX IF NOT EXISTS idx_restricoes_matricula ON restricoes_horario(matricula_siape);
