package dao;

import config.DatabaseConnection;
import model.Disciplina;
import model.Professor;
import model.Turma;

import java.sql.*;
import java.util.*;

/**
 * Data Access Object (DAO) para as Turmas da Oferta Acadêmica (CC + EC).
 * Gerencia a persistência na tabela 'turmas' e a relação N:M na tabela 'turma_professores'.
 */
public class TurmaDAO {

    public void inserir(Turma turma) throws SQLException {
        String sqlTurma = """
            INSERT INTO turmas (
                disciplina_codigo, codigo_turma, semestre, cursos_ofertados,
                horario_sigaa, vagas, matriculados, requer_alocacao_ic
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        """;
        String sqlVinculo = "INSERT INTO turma_professores (turma_id, professor_matricula, carga_horaria_docente) VALUES (?, ?, ?);";

        try (Connection conn = DatabaseConnection.getConnection()) {
            conn.setAutoCommit(false);
            try {
                try (PreparedStatement stmt = conn.prepareStatement(sqlTurma, Statement.RETURN_GENERATED_KEYS)) {
                    stmt.setString(1, turma.getDisciplina().getCodigo());
                    stmt.setString(2, turma.getCodigoTurma());
                    stmt.setString(3, turma.getSemestre());
                    stmt.setString(4, turma.getCursosOfertados());
                    stmt.setString(5, turma.getHorarioSigaa());
                    stmt.setInt(6, turma.getVagas());
                    stmt.setInt(7, turma.getMatriculados());
                    stmt.setInt(8, turma.isRequerAlocacaoIc() ? 1 : 0);

                    stmt.executeUpdate();

                    try (ResultSet gk = stmt.getGeneratedKeys()) {
                        if (gk.next()) {
                            turma.setId(gk.getInt(1));
                        }
                    }
                }

                try (PreparedStatement stmtVinculo = conn.prepareStatement(sqlVinculo)) {
                    for (Professor prof : turma.getProfessores()) {
                        int carga = turma.getCargaHorariaPorDocente()
                                .getOrDefault(prof.getMatriculaSiape(), turma.getDisciplina().getCargaHoraria());
                        stmtVinculo.setInt(1, turma.getId());
                        stmtVinculo.setString(2, prof.getMatriculaSiape());
                        stmtVinculo.setInt(3, carga);
                        stmtVinculo.addBatch();
                    }
                    stmtVinculo.executeBatch();
                }

                conn.commit();
            } catch (SQLException e) {
                conn.rollback();
                throw e;
            } finally {
                conn.setAutoCommit(true);
            }
        }
    }

    public Optional<Turma> buscarPorId(int id) throws SQLException {
        String sql = """
            SELECT t.id, t.codigo_turma, t.semestre, t.cursos_ofertados, t.horario_sigaa,
                   t.vagas, t.matriculados, t.requer_alocacao_ic,
                   d.codigo AS d_codigo, d.nome AS d_nome, d.carga_horaria AS d_ch, d.exige_laboratorio AS d_lab
            FROM turmas t
            JOIN disciplinas d ON t.disciplina_codigo = d.codigo
            WHERE t.id = ?;
        """;

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            stmt.setInt(1, id);

            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    Turma turma = mapearTurmaBase(rs);
                    carregarProfessoresDaTurma(conn, turma);
                    return Optional.of(turma);
                }
            }
        }
        return Optional.empty();
    }

    public List<Turma> listarTodas() throws SQLException {
        String sql = """
            SELECT t.id, t.codigo_turma, t.semestre, t.cursos_ofertados, t.horario_sigaa,
                   t.vagas, t.matriculados, t.requer_alocacao_ic,
                   d.codigo AS d_codigo, d.nome AS d_nome, d.carga_horaria AS d_ch, d.exige_laboratorio AS d_lab
            FROM turmas t
            JOIN disciplinas d ON t.disciplina_codigo = d.codigo
            ORDER BY d.codigo ASC, t.codigo_turma ASC;
        """;

        Map<Integer, Turma> mapaTurmas = new LinkedHashMap<>();

        try (Connection conn = DatabaseConnection.getConnection()) {
            try (PreparedStatement stmt = conn.prepareStatement(sql);
                 ResultSet rs = stmt.executeQuery()) {
                while (rs.next()) {
                    Turma t = mapearTurmaBase(rs);
                    mapaTurmas.put(t.getId(), t);
                }
            }

            // Carrega todos os vínculos N:M e indisponibilidades de uma só vez (evita problema N+1)
            vincularProfessoresEmLote(conn, mapaTurmas);
        }
        return new ArrayList<>(mapaTurmas.values());
    }

    /**
     * Hidrata professores e respectivas indisponibilidades (RN-02) em lote sobre um mapa de turmas.
     */
    static void vincularProfessoresEmLote(Connection conn, Map<Integer, Turma> mapaTurmas) throws SQLException {
        if (mapaTurmas == null || mapaTurmas.isEmpty()) {
            return;
        }
        Map<String, Professor> cacheProfessores = new HashMap<>();
        String sqlProfs = """
            SELECT tp.turma_id, tp.carga_horaria_docente,
                   p.matricula_siape, p.nome
            FROM turma_professores tp
            JOIN professores p ON tp.professor_matricula = p.matricula_siape;
        """;

        try (PreparedStatement stmtP = conn.prepareStatement(sqlProfs);
             ResultSet rsP = stmtP.executeQuery()) {
            while (rsP.next()) {
                Turma t = mapaTurmas.get(rsP.getInt("turma_id"));
                if (t != null) {
                    String siape = rsP.getString("matricula_siape");
                    Professor p = cacheProfessores.get(siape);
                    if (p == null) {
                        p = new Professor(siape, rsP.getString("nome"));
                        cacheProfessores.put(siape, p);
                    }
                    t.adicionarProfessor(p, rsP.getInt("carga_horaria_docente"));
                }
            }
        }

        ProfessorDAO.carregarIndisponibilidades(conn, cacheProfessores);
    }

    public void deletar(int id) throws SQLException {
        String sql = "DELETE FROM turmas WHERE id = ?;";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            stmt.setInt(1, id);
            stmt.executeUpdate();
        }
    }

    private void carregarProfessoresDaTurma(Connection conn, Turma turma) throws SQLException {
        String sql = """
            SELECT tp.carga_horaria_docente, p.matricula_siape, p.nome
            FROM turma_professores tp
            JOIN professores p ON tp.professor_matricula = p.matricula_siape
            WHERE tp.turma_id = ?;
        """;

        Map<String, Professor> cache = new HashMap<>();
        try (PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setInt(1, turma.getId());
            try (ResultSet rs = stmt.executeQuery()) {
                while (rs.next()) {
                    String siape = rs.getString("matricula_siape");
                    Professor p = new Professor(siape, rs.getString("nome"));
                    cache.put(siape, p);
                    turma.adicionarProfessor(p, rs.getInt("carga_horaria_docente"));
                }
            }
        }
        ProfessorDAO.carregarIndisponibilidades(conn, cache);
    }

    private Turma mapearTurmaBase(ResultSet rs) throws SQLException {
        Disciplina d = new Disciplina(
                rs.getString("d_codigo"),
                rs.getString("d_nome"),
                rs.getInt("d_ch"),
                rs.getInt("d_lab") == 1
        );

        return new Turma(
                rs.getInt("id"),
                d,
                rs.getString("codigo_turma"),
                rs.getString("semestre"),
                rs.getString("cursos_ofertados"),
                rs.getString("horario_sigaa"),
                rs.getInt("vagas"),
                rs.getInt("matriculados"),
                rs.getInt("requer_alocacao_ic") == 1
        );
    }
}
