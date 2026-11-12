package dao;

import config.DatabaseConnection;
import model.Disciplina;

import java.sql.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Data Access Object (DAO) para a Matriz de Disciplinas e Requisitos de Laboratório (RN-04).
 */
public class DisciplinaDAO {

    public void inserir(Disciplina disciplina) throws SQLException {
        String sql = "INSERT INTO disciplinas (codigo, nome, carga_horaria, exige_laboratorio) VALUES (?, ?, ?, ?);";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            stmt.setString(1, disciplina.getCodigo());
            stmt.setString(2, disciplina.getNome());
            stmt.setInt(3, disciplina.getCargaHoraria());
            stmt.setInt(4, disciplina.isExigeLaboratorio() ? 1 : 0);

            stmt.executeUpdate();
        }
    }

    public Optional<Disciplina> buscarPorCodigo(String codigo) throws SQLException {
        String sql = "SELECT codigo, nome, carga_horaria, exige_laboratorio FROM disciplinas WHERE codigo = ?;";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            stmt.setString(1, codigo);

            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    return Optional.of(mapearResultSet(rs));
                }
            }
        }
        return Optional.empty();
    }

    public List<Disciplina> listarTodas() throws SQLException {
        String sql = "SELECT codigo, nome, carga_horaria, exige_laboratorio FROM disciplinas ORDER BY codigo ASC;";
        List<Disciplina> lista = new ArrayList<>();

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql);
             ResultSet rs = stmt.executeQuery()) {

            while (rs.next()) {
                lista.add(mapearResultSet(rs));
            }
        }
        return lista;
    }

    public void atualizar(Disciplina disciplina) throws SQLException {
        String sql = "UPDATE disciplinas SET nome = ?, carga_horaria = ?, exige_laboratorio = ? WHERE codigo = ?;";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            stmt.setString(1, disciplina.getNome());
            stmt.setInt(2, disciplina.getCargaHoraria());
            stmt.setInt(3, disciplina.isExigeLaboratorio() ? 1 : 0);
            stmt.setString(4, disciplina.getCodigo());

            stmt.executeUpdate();
        }
    }

    public void deletar(String codigo) throws SQLException {
        String sql = "DELETE FROM disciplinas WHERE codigo = ?;";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            stmt.setString(1, codigo);
            stmt.executeUpdate();
        }
    }

    private Disciplina mapearResultSet(ResultSet rs) throws SQLException {
        String codigo = rs.getString("codigo");
        String nome = rs.getString("nome");
        int ch = rs.getInt("carga_horaria");
        boolean exigeLab = rs.getInt("exige_laboratorio") == 1;

        return new Disciplina(codigo, nome, ch, exigeLab);
    }
}
