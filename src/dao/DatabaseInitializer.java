package dao;

import config.DatabaseConnection;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;

/**
 * Utilitário de inicialização do Schema Relacional do SATIC no SQLite.
 * Espelha integralmente o Diagrama Entidade-Relacionamento (DER) atualizado para CC + EC + IM.
 */
public class DatabaseInitializer {

    public static void initialize() {
        String[] ddlStatements = {
            // 1. Tabela de Espaços Físicos / Salas (IC, BL12, IM e Externos)
            """
            CREATE TABLE IF NOT EXISTS salas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL UNIQUE,
                capacidade INTEGER NOT NULL,
                tipo_espaco TEXT NOT NULL DEFAULT 'Sala',
                bloco TEXT NOT NULL DEFAULT 'IC',
                alocavel_ic INTEGER NOT NULL DEFAULT 1
            );
            """,

            // 2. Tabela de Professores
            """
            CREATE TABLE IF NOT EXISTS professores (
                matricula_siape TEXT PRIMARY KEY,
                nome TEXT NOT NULL
            );
            """,

            // 3. Tabela de Indisponibilidades Docentes (RN-02)
            """
            CREATE TABLE IF NOT EXISTS indisponibilidades_docentes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                professor_matricula TEXT NOT NULL,
                dia_semana TEXT NOT NULL,
                turno TEXT NOT NULL,
                indice_horario TEXT NOT NULL,
                FOREIGN KEY (professor_matricula) REFERENCES professores(matricula_siape) ON DELETE CASCADE
            );
            """,

            // 4. Tabela de Disciplinas (Matriz Curricular — PK por código único)
            """
            CREATE TABLE IF NOT EXISTS disciplinas (
                codigo TEXT PRIMARY KEY,
                nome TEXT NOT NULL,
                carga_horaria INTEGER NOT NULL,
                exige_laboratorio INTEGER NOT NULL DEFAULT 0
            );
            """,

            // 5. Tabela de Turmas Ofertadas (Deduplicada por semestre + disciplina + codigo_turma)
            """
            CREATE TABLE IF NOT EXISTS turmas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                disciplina_codigo TEXT NOT NULL,
                codigo_turma TEXT NOT NULL,
                semestre TEXT NOT NULL,
                cursos_ofertados TEXT NOT NULL,
                horario_sigaa TEXT NOT NULL,
                vagas INTEGER NOT NULL,
                matriculados INTEGER NOT NULL DEFAULT 0,
                requer_alocacao_ic INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY (disciplina_codigo) REFERENCES disciplinas(codigo) ON DELETE RESTRICT,
                UNIQUE (semestre, disciplina_codigo, codigo_turma)
            );
            """,

            // 6. Tabela Associativa N:M Turma <-> Professor (suporta co-docência)
            """
            CREATE TABLE IF NOT EXISTS turma_professores (
                turma_id INTEGER NOT NULL,
                professor_matricula TEXT NOT NULL,
                carga_horaria_docente INTEGER NOT NULL DEFAULT 60,
                PRIMARY KEY (turma_id, professor_matricula),
                FOREIGN KEY (turma_id) REFERENCES turmas(id) ON DELETE CASCADE,
                FOREIGN KEY (professor_matricula) REFERENCES professores(matricula_siape) ON DELETE RESTRICT
            );
            """,

            // 7. Tabela de Alocações Físicas (Entidade Associativa entre Turma e Sala)
            """
            CREATE TABLE IF NOT EXISTS alocacoes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                turma_id INTEGER NOT NULL,
                sala_id INTEGER NOT NULL,
                horario_codigo TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'RASCUNHO',
                data_geracao TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (turma_id) REFERENCES turmas(id) ON DELETE CASCADE,
                FOREIGN KEY (sala_id) REFERENCES salas(id) ON DELETE RESTRICT
            );
            """
        };

        try (Connection conn = DatabaseConnection.getConnection();
             Statement stmt = conn.createStatement()) {

            for (String sql : ddlStatements) {
                stmt.execute(sql);
            }
            System.out.println("[SATIC-DB] Schema SQLite verificado e inicializado em: " + DatabaseConnection.getDatabasePath());

        } catch (SQLException e) {
            System.err.println("[SATIC-DB] Falha ao inicializar o banco de dados: " + e.getMessage());
            throw new RuntimeException("Erro ao criar schema SQLite", e);
        }
    }

    /**
     * Remove e recria todas as tabelas do schema (útil para resets de demonstração ou testes).
     */
    public static void recreateSchema() {
        String[] dropStatements = {
            "DROP TABLE IF EXISTS alocacoes;",
            "DROP TABLE IF EXISTS turma_professores;",
            "DROP TABLE IF EXISTS turmas;",
            "DROP TABLE IF EXISTS disciplinas;",
            "DROP TABLE IF EXISTS indisponibilidades_docentes;",
            "DROP TABLE IF EXISTS professores;",
            "DROP TABLE IF EXISTS salas;"
        };

        try (Connection conn = DatabaseConnection.getConnection();
             Statement stmt = conn.createStatement()) {
            for (String sql : dropStatements) {
                stmt.execute(sql);
            }
        } catch (SQLException e) {
            throw new RuntimeException("Erro ao limpar schema SQLite", e);
        }
        initialize();
    }
}
