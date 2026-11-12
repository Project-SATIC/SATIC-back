package dao;

import config.DatabaseConnection;
import model.Alocacao;
import model.Disciplina;
import model.Professor;
import model.Sala;
import model.Turma;

import java.sql.*;
import java.util.*;

/**
 * Data Access Object (DAO) para as Propostas de Alocação calculadas pelo motor ou ajustadas pela secretaria.
 */
public class AlocacaoDAO {

    public void inserir(Alocacao alocacao) throws SQLException {
        String sql = "INSERT INTO alocacoes (turma_id, sala_id, horario_codigo, status) VALUES (?, ?, ?, ?);";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {

            stmt.setInt(1, alocacao.getTurma().getId());
            stmt.setInt(2, alocacao.getSala().getId());
            stmt.setString(3, alocacao.getHorarioCodigo());
            stmt.setString(4, alocacao.getStatus());

            stmt.executeUpdate();

            try (ResultSet gk = stmt.getGeneratedKeys()) {
                if (gk.next()) {
                    alocacao.setId(gk.getInt(1));
                }
            }
        }
    }

    public List<Alocacao> listarTodas() throws SQLException {
        String sql = """
            SELECT a.id AS a_id, a.horario_codigo, a.status, a.data_geracao,
                   s.id AS s_id, s.nome AS s_nome, s.capacidade AS s_cap,
                   s.tipo_espaco AS s_tipo, s.bloco AS s_bloco, s.alocavel_ic AS s_alocavel,
                   t.id AS t_id, t.codigo_turma, t.semestre, t.cursos_ofertados, t.horario_sigaa,
                   t.vagas, t.matriculados, t.requer_alocacao_ic,
                   d.codigo AS d_codigo, d.nome AS d_nome, d.carga_horaria AS d_ch, d.exige_laboratorio AS d_lab
            FROM alocacoes a
            JOIN salas s ON a.sala_id = s.id
            JOIN turmas t ON a.turma_id = t.id
            JOIN disciplinas d ON t.disciplina_codigo = d.codigo
            ORDER BY a.horario_codigo ASC, s.nome ASC;
        """;

        List<Alocacao> lista = new ArrayList<>();
        Map<Integer, Turma> cacheTurmas = new HashMap<>();

        try (Connection conn = DatabaseConnection.getConnection()) {
            try (PreparedStatement stmt = conn.prepareStatement(sql);
                 ResultSet rs = stmt.executeQuery()) {

                while (rs.next()) {
                    Sala sala = new Sala(
                            rs.getInt("s_id"),
                            rs.getString("s_nome"),
                            rs.getInt("s_cap"),
                            rs.getString("s_tipo"),
                            rs.getString("s_bloco"),
                            rs.getInt("s_alocavel") == 1
                    );

                    int turmaId = rs.getInt("t_id");
                    Turma turma = cacheTurmas.get(turmaId);
                    if (turma == null) {
                        Disciplina disc = new Disciplina(
                                rs.getString("d_codigo"),
                                rs.getString("d_nome"),
                                rs.getInt("d_ch"),
                                rs.getInt("d_lab") == 1
                        );

                        turma = new Turma(
                                turmaId,
                                disc,
                                rs.getString("codigo_turma"),
                                rs.getString("semestre"),
                                rs.getString("cursos_ofertados"),
                                rs.getString("horario_sigaa"),
                                rs.getInt("vagas"),
                                rs.getInt("matriculados"),
                                rs.getInt("requer_alocacao_ic") == 1
                        );
                        cacheTurmas.put(turmaId, turma);
                    }

                    Alocacao aloc = new Alocacao(
                            rs.getInt("a_id"),
                            turma,
                            sala,
                            rs.getString("horario_codigo"),
                            rs.getString("status"),
                            rs.getString("data_geracao")
                    );
                    lista.add(aloc);
                }
            }

            TurmaDAO.vincularProfessoresEmLote(conn, cacheTurmas);
        }
        return lista;
    }

    public void limparTodas() throws SQLException {
        String sql = "DELETE FROM alocacoes;";

        try (Connection conn = DatabaseConnection.getConnection();
             Statement stmt = conn.createStatement()) {

            stmt.execute(sql);
        }
    }

    public void deletar(int id) throws SQLException {
        String sql = "DELETE FROM alocacoes WHERE id = ?;";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            stmt.setInt(1, id);
            stmt.executeUpdate();
        }
    }
}
