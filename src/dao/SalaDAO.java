package dao;

import config.DatabaseConnection;
import model.Sala;

import java.sql.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Data Access Object (DAO) para espaços físicos (Bloco IC, BL12, IM e Externos).
 */
public class SalaDAO {

    public void inserir(Sala sala) throws SQLException {
        String sql = "INSERT INTO salas (nome, capacidade, tipo_espaco, bloco, alocavel_ic) VALUES (?, ?, ?, ?, ?);";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {

            stmt.setString(1, sala.getNome());
            stmt.setInt(2, sala.getCapacidade());
            stmt.setString(3, sala.getTipoEspaco());
            stmt.setString(4, sala.getBloco());
            stmt.setInt(5, sala.isAlocavelIc() ? 1 : 0);

            stmt.executeUpdate();

            try (ResultSet generatedKeys = stmt.getGeneratedKeys()) {
                if (generatedKeys.next()) {
                    sala.setId(generatedKeys.getInt(1));
                }
            }
        }
    }

    public Optional<Sala> buscarPorId(int id) throws SQLException {
        String sql = "SELECT id, nome, capacidade, tipo_espaco, bloco, alocavel_ic FROM salas WHERE id = ?;";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            stmt.setInt(1, id);

            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    return Optional.of(mapearResultSet(rs));
                }
            }
        }
        return Optional.empty();
    }

    public Optional<Sala> buscarPorNome(String nome) throws SQLException {
        String sql = "SELECT id, nome, capacidade, tipo_espaco, bloco, alocavel_ic FROM salas WHERE nome = ?;";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            stmt.setString(1, nome);

            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    return Optional.of(mapearResultSet(rs));
                }
            }
        }
        return Optional.empty();
    }

    public List<Sala> listarTodas() throws SQLException {
        String sql = "SELECT id, nome, capacidade, tipo_espaco, bloco, alocavel_ic FROM salas ORDER BY bloco ASC, nome ASC;";
        List<Sala> lista = new ArrayList<>();

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql);
             ResultSet rs = stmt.executeQuery()) {

            while (rs.next()) {
                lista.add(mapearResultSet(rs));
            }
        }
        return lista;
    }

    public List<Sala> listarAlocaveisPeloIc() throws SQLException {
        String sql = "SELECT id, nome, capacidade, tipo_espaco, bloco, alocavel_ic FROM salas WHERE alocavel_ic = 1 ORDER BY bloco ASC, nome ASC;";
        List<Sala> lista = new ArrayList<>();

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql);
             ResultSet rs = stmt.executeQuery()) {

            while (rs.next()) {
                lista.add(mapearResultSet(rs));
            }
        }
        return lista;
    }

    public void atualizar(Sala sala) throws SQLException {
        String sql = "UPDATE salas SET nome = ?, capacidade = ?, tipo_espaco = ?, bloco = ?, alocavel_ic = ? WHERE id = ?;";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            stmt.setString(1, sala.getNome());
            stmt.setInt(2, sala.getCapacidade());
            stmt.setString(3, sala.getTipoEspaco());
            stmt.setString(4, sala.getBloco());
            stmt.setInt(5, sala.isAlocavelIc() ? 1 : 0);
            stmt.setInt(6, sala.getId());

            stmt.executeUpdate();
        }
    }

    public void deletar(int id) throws SQLException {
        String sql = "DELETE FROM salas WHERE id = ?;";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            stmt.setInt(1, id);
            stmt.executeUpdate();
        }
    }

    private Sala mapearResultSet(ResultSet rs) throws SQLException {
        return new Sala(
                rs.getInt("id"),
                rs.getString("nome"),
                rs.getInt("capacidade"),
                rs.getString("tipo_espaco"),
                rs.getString("bloco"),
                rs.getInt("alocavel_ic") == 1
        );
    }
}
