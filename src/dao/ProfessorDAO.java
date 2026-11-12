package dao;

import config.DatabaseConnection;
import model.IndisponibilidadeDocente;
import model.Professor;

import java.sql.*;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Data Access Object (DAO) para Docentes e suas janelas de indisponibilidade (RN-02).
 */
public class ProfessorDAO {

    public void inserir(Professor professor) throws SQLException {
        String sql = "INSERT INTO professores (matricula_siape, nome) VALUES (?, ?);";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            stmt.setString(1, professor.getMatriculaSiape());
            stmt.setString(2, professor.getNome());
            stmt.executeUpdate();
        }
    }

    public Optional<Professor> buscarPorSiape(String siape) throws SQLException {
        String sql = "SELECT matricula_siape, nome FROM professores WHERE matricula_siape = ?;";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            stmt.setString(1, siape);

            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    Professor p = new Professor(rs.getString("matricula_siape"), rs.getString("nome"));
                    p.setIndisponibilidades(listarIndisponibilidadesPorProfessor(siape));
                    return Optional.of(p);
                }
            }
        }
        return Optional.empty();
    }

    public List<Professor> listarTodos() throws SQLException {
        String sql = "SELECT matricula_siape, nome FROM professores ORDER BY nome ASC;";
        Map<String, Professor> mapa = new LinkedHashMap<>();

        try (Connection conn = DatabaseConnection.getConnection()) {
            try (PreparedStatement stmt = conn.prepareStatement(sql);
                 ResultSet rs = stmt.executeQuery()) {

                while (rs.next()) {
                    String siape = rs.getString("matricula_siape");
                    mapa.put(siape, new Professor(siape, rs.getString("nome")));
                }
            }
            carregarIndisponibilidades(conn, mapa);
        }
        return new ArrayList<>(mapa.values());
    }

    /**
     * Hidrata em lote todas as indisponibilidades cadastradas para os docentes em cache.
     */
    static void carregarIndisponibilidades(Connection conn, Map<String, Professor> cacheProfessores) throws SQLException {
        if (cacheProfessores == null || cacheProfessores.isEmpty()) {
            return;
        }
        String sql = "SELECT id, professor_matricula, dia_semana, turno, indice_horario FROM indisponibilidades_docentes;";
        try (PreparedStatement stmt = conn.prepareStatement(sql);
             ResultSet rs = stmt.executeQuery()) {
            while (rs.next()) {
                String siape = rs.getString("professor_matricula");
                Professor p = cacheProfessores.get(siape);
                if (p != null) {
                    p.adicionarIndisponibilidade(new IndisponibilidadeDocente(
                            rs.getInt("id"),
                            siape,
                            rs.getString("dia_semana"),
                            rs.getString("turno"),
                            rs.getString("indice_horario")
                    ));
                }
            }
        }
    }

    public void deletar(String siape) throws SQLException {
        String sql = "DELETE FROM professores WHERE matricula_siape = ?;";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            stmt.setString(1, siape);
            stmt.executeUpdate();
        }
    }

    // --- Métodos de Indisponibilidade Docente ---

    public void inserirIndisponibilidade(IndisponibilidadeDocente ind) throws SQLException {
        String sql = "INSERT INTO indisponibilidades_docentes (professor_matricula, dia_semana, turno, indice_horario) VALUES (?, ?, ?, ?);";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {

            stmt.setString(1, ind.getProfessorMatricula());
            stmt.setString(2, ind.getDiaSemana());
            stmt.setString(3, ind.getTurno());
            stmt.setString(4, ind.getIndiceHorario());

            stmt.executeUpdate();

            try (ResultSet gk = stmt.getGeneratedKeys()) {
                if (gk.next()) {
                    ind.setId(gk.getInt(1));
                }
            }
        }
    }

    public List<IndisponibilidadeDocente> listarIndisponibilidadesPorProfessor(String siape) throws SQLException {
        String sql = "SELECT id, professor_matricula, dia_semana, turno, indice_horario FROM indisponibilidades_docentes WHERE professor_matricula = ?;";
        List<IndisponibilidadeDocente> lista = new ArrayList<>();

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            stmt.setString(1, siape);

            try (ResultSet rs = stmt.executeQuery()) {
                while (rs.next()) {
                    lista.add(new IndisponibilidadeDocente(
                            rs.getInt("id"),
                            rs.getString("professor_matricula"),
                            rs.getString("dia_semana"),
                            rs.getString("turno"),
                            rs.getString("indice_horario")
                    ));
                }
            }
        }
        return lista;
    }
}
