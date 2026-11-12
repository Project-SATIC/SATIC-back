import dao.AlocacaoDAO;
import dao.DatabaseSeeder;
import dao.SalaDAO;
import dao.TurmaDAO;
import model.Alocacao;
import model.Sala;
import model.Turma;
import service.ValidadorDeRestricoes;

import java.sql.SQLException;
import java.util.*;

/**
 * Ponto de entrada do Back-End do SATIC.
 * Executa a carga do SQLite (CC + EC 2026.2), aciona o motor de busca em espaço de estados
 * com validação rigorosa das regras RN-01 a RN-04, persiste a proposta no banco
 * e compara os resultados obtidos contra o Gabarito Real do SIGAA.
 */
public class Main {

    public static void main(String[] args) {
        try {
            // 1. Garante inicialização do schema SQLite e carga real 2026.2 caso o banco esteja vazio
            DatabaseSeeder.seed(false);

            SalaDAO salaDAO = new SalaDAO();
            TurmaDAO turmaDAO = new TurmaDAO();
            AlocacaoDAO alocDAO = new AlocacaoDAO();

            List<Sala> todasSalas = salaDAO.listarTodas();
            List<Sala> salasAlocaveis = salaDAO.listarAlocaveisPeloIc();
            List<Turma> todasTurmas = turmaDAO.listarTodas();

            // Mapa auxiliar de salas por nome para registrar reservas externas fixas (IF0001, FALE0002)
            Map<String, Sala> mapaSalas = new HashMap<>();
            for (Sala s : todasSalas) {
                mapaSalas.put(s.getNome(), s);
            }

            List<Turma> turmasParaAlocar = new ArrayList<>();
            List<Alocacao> reservasFixasExternas = new ArrayList<>();
            Map<String, String> gabarito = DatabaseSeeder.getGabaritoSigaa();

            for (Turma t : todasTurmas) {
                if (t.isRequerAlocacaoIc()) {
                    turmasParaAlocar.add(t);
                } else {
                    // Disciplinas externas (IF0001, FALE0002) que já têm sala reservada no BL12/CEPETEC
                    String chave = t.getDisciplina().getCodigo() + "-" + t.getCodigoTurma();
                    String salaReservadaNome = gabarito.get(chave);
                    Sala salaReservada = mapaSalas.get(salaReservadaNome);
                    if (salaReservada != null && salaReservada.isAlocavelIc()) {
                        reservasFixasExternas.add(new Alocacao(t, salaReservada, t.getHorarioSigaa(), "EXTERNA_FIXA"));
                    }
                }
            }

            System.out.println("\n=====================================================================");
            System.out.println("  SATIC — MOTOR DE BUSCA EM ESPAÇO DE ESTADOS (OFERTA REAL 2026.2)");
            System.out.println("=====================================================================");
            System.out.printf("Turmas para alocar no IC/BL12/IM: %d | Salas disponíveis: %d | Reservas externas: %d%n",
                    turmasParaAlocar.size(), salasAlocaveis.size(), reservasFixasExternas.size());

            // 2. Execução do algoritmo de busca em espaço de estados
            ValidadorDeRestricoes validador = new ValidadorDeRestricoes();
            StateSpaceSearch motor = new StateSpaceSearch(turmasParaAlocar, salasAlocaveis, reservasFixasExternas, validador);
            StateSpaceSearch.ResultadoBusca resultado = motor.solve();

            // 3. Persistência da proposta gerada no SQLite
            alocDAO.limparTodas();
            for (Alocacao aloc : resultado.getAlocacoes()) {
                alocDAO.inserir(aloc);
            }

            // 4. Exibição de métricas e validação independente
            System.out.println("\n--- MÉTRICAS DO MOTOR ---");
            System.out.printf("Status da Busca      : %s%n", resultado.isCompleto() ? "COMPLETA (100% alocadas sem conflitos rígidos)" : "PARCIAL");
            System.out.printf("Turmas Alocadas      : %d / %d%n", resultado.getAlocacoes().size(), turmasParaAlocar.size());
            System.out.printf("Turmas Pendentes     : %d%n", resultado.getTurmasPendentes().size());
            System.out.printf("Tempo Processamento  : %d ms%n", resultado.getTempoMs());
            System.out.printf("Nós Visitados        : %d%n", resultado.getNosVisitados());
            System.out.printf("Podas Realizadas     : %d%n", resultado.getPodas());

            if (!resultado.getTurmasPendentes().isEmpty()) {
                System.out.println("\n[PENDÊNCIAS ENCONTRADAS]");
                for (Turma pend : resultado.getTurmasPendentes()) {
                    System.out.println("  - " + pend.getIdentificadorExibicao() + " | Horário: " + pend.getHorarioSigaa() + " | Alunos: " + pend.getNumeroAlunos());
                }
            }

            // Auditoria de restrições e métricas de otimização (Soft Constraints)
            int violacoes = 0;
            double somaOcupacao = 0;
            Map<String, Integer> usoPorBloco = new TreeMap<>();
            List<Alocacao> alocacoesSalvas = alocDAO.listarTodas();

            for (Alocacao a : alocacoesSalvas) {
                List<Alocacao> outras = new ArrayList<>(alocacoesSalvas);
                outras.addAll(reservasFixasExternas);
                List<String> diag = validador.diagnosticarViolacoes(a.getTurma(), a.getSala(), outras);
                if (!diag.isEmpty()) {
                    violacoes += diag.size();
                    System.err.println("Violação detectada em " + a.getTurma().getIdentificadorExibicao() + ": " + diag);
                }
                double taxa = (double) a.getTurma().getNumeroAlunos() / a.getSala().getCapacidade() * 100.0;
                somaOcupacao += taxa;
                usoPorBloco.merge(a.getSala().getBloco(), 1, Integer::sum);
            }

            System.out.println("\n--- AUDITORIA & OTIMIZAÇÃO (SOFT CONSTRAINTS) ---");
            System.out.printf("Violações RN-01..04  : %d%n", violacoes);
            System.out.printf("Ocupação Média Salas : %.1f%%%n", alocacoesSalvas.isEmpty() ? 0 : somaOcupacao / alocacoesSalvas.size());
            System.out.println("Distribuição/Bloco   : " + usoPorBloco);

            // 5. Comparativo Amostral com o Gabarito Real do SIGAA 2026.2
            System.out.println("\n--- COMPARATIVO: PROPOSTA SATIC vs. GABARITO REAL DO SIGAA (Amostra) ---");
            Set<String> destaques = Set.of(
                    "CPT0035-01", "COMP373-02", "COMP362-01", "ECOM003-01",
                    "COMP382-01", "IART001-01", "ECOM013-01", "COMP388-02",
                    "COMP359-01", "ECOM002-01", "COMP369-03"
            );

            System.out.printf("%-48s | %-7s | %-26s | %-26s%n",
                    "Turma", "Mat/Cap", "Proposta SATIC (Best-Fit)", "Gabarito Real SIGAA");
            System.out.println("-".repeat(116));

            for (Alocacao a : alocacoesSalvas) {
                Turma t = a.getTurma();
                String chave = t.getDisciplina().getCodigo() + "-" + t.getCodigoTurma();
                if (destaques.contains(chave)) {
                    String gabaritoSala = gabarito.getOrDefault(chave, "IC - A definir (Pendente no SIGAA!)");
                    System.out.printf("%-48s | %3d/%-3d | %-26s | %-26s%n",
                            truncar(t.getIdentificadorExibicao(), 48),
                            t.getMatriculados(), t.getVagas(),
                            truncar(a.getSala().getNome() + " (" + a.getSala().getCapacidade() + ")", 26),
                            gabaritoSala);
                }
            }
            System.out.println("=====================================================================\n");

        } catch (SQLException e) {
            System.err.println("Erro de banco de dados na execução do SATIC: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private static String truncar(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max - 3) + "...";
    }
}
