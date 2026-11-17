import config.DatabaseConnection;
import dao.*;
import model.*;
import service.ValidadorDeRestricoes;

import java.util.*;

/**
 * Gera o gabarito JSON do motor Java (mesmo fluxo de Main.java) em um banco SQLite temporário,
 * para comparar com o porte TypeScript (test/golden.test.ts).
 *
 * Uso (na pasta SATIC-back, depois de compilar src/ em bin/):
 *   javac -encoding UTF-8 -cp "bin;lib/*" -d ts/tools/out ts/tools/GoldenDump.java
 *   java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp "ts/tools/out;bin;lib/*" GoldenDump <arquivo.db> [opções]
 *
 * Opções (para cenários de estresse):
 *   sem=<nome da sala>                   remove a sala do conjunto alocável (pode repetir)
 *   indisp=<siape>:<dia>:<turno>:<idx>   adiciona indisponibilidade ao docente (pode repetir)
 */
public class GoldenDump {
    static String q(String s) { return s == null ? "null" : "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""; }
    static String chave(Turma t) { return t.getDisciplina().getCodigo() + "-" + t.getCodigoTurma(); }

    public static void main(String[] args) throws Exception {
        DatabaseConnection.useDatabasePath(args[0]);
        try {
            DatabaseSeeder.seed(true);
            SalaDAO salaDAO = new SalaDAO();
            TurmaDAO turmaDAO = new TurmaDAO();
            List<Sala> todasSalas = salaDAO.listarTodas();
            List<Sala> salasAlocaveis = new ArrayList<>(salaDAO.listarAlocaveisPeloIc());
            List<Turma> todasTurmas = turmaDAO.listarTodas();
            for (int i = 1; i < args.length; i++) {
                if (args[i].startsWith("sem=")) {
                    String nome = args[i].substring(4);
                    salasAlocaveis.removeIf(s -> s.getNome().equals(nome));
                } else if (args[i].startsWith("indisp=")) {
                    String[] p = args[i].substring(7).split(":");
                    for (Turma t : todasTurmas)
                        for (Professor prof : t.getProfessores())
                            if (prof.getMatriculaSiape().equals(p[0]))
                                prof.adicionarIndisponibilidade(new IndisponibilidadeDocente(p[0], p[1], p[2], p[3]));
                }
            }
            Map<String, Sala> mapaSalas = new HashMap<>();
            for (Sala s : todasSalas) mapaSalas.put(s.getNome(), s);
            Map<String, String> gabarito = DatabaseSeeder.getGabaritoSigaa();
            List<Turma> turmasParaAlocar = new ArrayList<>();
            List<Alocacao> reservas = new ArrayList<>();
            for (Turma t : todasTurmas) {
                if (t.isRequerAlocacaoIc()) turmasParaAlocar.add(t);
                else {
                    Sala s = mapaSalas.get(gabarito.get(chave(t)));
                    if (s != null && s.isAlocavelIc()) reservas.add(new Alocacao(t, s, t.getHorarioSigaa(), "EXTERNA_FIXA"));
                }
            }
            StateSpaceSearch.ResultadoBusca r = new StateSpaceSearch(turmasParaAlocar, salasAlocaveis, reservas, new ValidadorDeRestricoes()).solve();

            StringBuilder sb = new StringBuilder("{\n");
            sb.append("  \"completo\": ").append(r.isCompleto()).append(",\n");
            sb.append("  \"nosVisitados\": ").append(r.getNosVisitados()).append(",\n");
            sb.append("  \"podas\": ").append(r.getPodas()).append(",\n");
            sb.append("  \"turmas\": [");
            for (int i = 0; i < todasTurmas.size(); i++) {
                Turma t = todasTurmas.get(i);
                StringBuilder profs = new StringBuilder();
                for (Professor p : t.getProfessores()) profs.append(profs.length() > 0 ? "," : "").append(q(p.getMatriculaSiape()));
                sb.append(i > 0 ? "," : "").append("\n    {\"chave\": ").append(q(chave(t)))
                  .append(", \"cursos\": ").append(q(t.getCursosOfertados()))
                  .append(", \"horario\": ").append(q(t.getHorarioSigaa()))
                  .append(", \"siapes\": [").append(profs).append("]}");
            }
            sb.append("\n  ],\n  \"reservas\": [");
            for (int i = 0; i < reservas.size(); i++) sb.append(i > 0 ? ", " : "").append("{\"turma\": ").append(q(chave(reservas.get(i).getTurma()))).append(", \"sala\": ").append(q(reservas.get(i).getSala().getNome())).append("}");
            sb.append("],\n  \"alocacoes\": [");
            List<Alocacao> as = r.getAlocacoes();
            for (int i = 0; i < as.size(); i++) {
                Alocacao a = as.get(i);
                sb.append(i > 0 ? "," : "").append("\n    {\"turma\": ").append(q(chave(a.getTurma()))).append(", \"sala\": ").append(q(a.getSala().getNome()))
                  .append(", \"horario\": ").append(q(a.getHorarioCodigo())).append(", \"status\": ").append(q(a.getStatus())).append("}");
            }
            sb.append("\n  ],\n  \"pendentes\": [");
            List<Turma> ps = r.getTurmasPendentes();
            for (int i = 0; i < ps.size(); i++) sb.append(i > 0 ? ", " : "").append(q(chave(ps.get(i))));
            sb.append("]\n}\n");
            System.out.print(sb);
        } finally {
            DatabaseConnection.resetDefaultDatabase();
        }
    }
}
