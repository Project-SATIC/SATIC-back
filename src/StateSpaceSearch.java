import model.Alocacao;
import model.Sala;
import model.Turma;
import service.SigaaHorarioParser;
import service.ValidadorDeRestricoes;

import java.util.*;

/**
 * Motor de Busca em Espaço de Estados (Backtracking com Poda e Heurística MRV + Best-Fit)
 * para alocação assistida de espaços físicos no SATIC (fase pós-oferta).
 */
public class StateSpaceSearch {

    public static class ResultadoBusca {
        private final boolean completo;
        private final List<Alocacao> alocacoes;
        private final List<Turma> turmasPendentes;
        private final long podas;
        private final long nosVisitados;
        private final long tempoMs;

        public ResultadoBusca(boolean completo, List<Alocacao> alocacoes, List<Turma> turmasPendentes,
                              long podas, long nosVisitados, long tempoMs) {
            this.completo = completo;
            this.alocacoes = alocacoes;
            this.turmasPendentes = turmasPendentes;
            this.podas = podas;
            this.nosVisitados = nosVisitados;
            this.tempoMs = tempoMs;
        }

        public boolean isCompleto() { return completo; }
        public List<Alocacao> getAlocacoes() { return alocacoes; }
        public List<Turma> getTurmasPendentes() { return turmasPendentes; }
        public long getPodas() { return podas; }
        public long getNosVisitados() { return nosVisitados; }
        public long getTempoMs() { return tempoMs; }
    }

    private static final long MAX_NOS_BUSCA = 300_000L;

    private final List<Turma> turmasOrdenadas;
    private final Map<Turma, List<Sala>> dominioSalasPorTurma;
    private final List<Alocacao> alocacoesPreExistentes;
    private final ValidadorDeRestricoes validador;

    private long podas = 0;
    private long nosVisitados = 0;
    private List<Alocacao> melhorSolucaoParcial = new ArrayList<>();

    public StateSpaceSearch(List<Turma> turmasParaAlocar, List<Sala> salasDisponiveis,
                            List<Alocacao> alocacoesPreExistentes, ValidadorDeRestricoes validador) {
        this.validador = validador;
        this.alocacoesPreExistentes = alocacoesPreExistentes != null ? alocacoesPreExistentes : List.of();
        this.dominioSalasPorTurma = new HashMap<>();

        // Pré-calcula o domínio válido estático de salas (RN-03 Capacidade + RN-04 Lab)
        // ordenado por Soft Constraint: preferência por salas não-lab para teóricas + Best-Fit (capacidade ASC)
        for (Turma t : turmasParaAlocar) {
            List<Sala> candidatas = new ArrayList<>();
            for (Sala s : salasDisponiveis) {
                if (validador.verificarCapacidade(t, s) && validador.verificarRequisitoLab(t, s)) {
                    candidatas.add(s);
                } else {
                    podas++;
                }
            }
            candidatas.sort(ordenarSalasSoftConstraint(t));
            dominioSalasPorTurma.put(t, candidatas);
        }

        // Ordenação gulosa / MRV: turmas mais restritas primeiro (menor domínio de salas, exige lab, mais alunos, mais horários)
        this.turmasOrdenadas = new ArrayList<>(turmasParaAlocar);
        this.turmasOrdenadas.sort((a, b) -> {
            int domA = dominioSalasPorTurma.get(a).size();
            int domB = dominioSalasPorTurma.get(b).size();
            if (domA != domB) return Integer.compare(domA, domB);

            boolean labA = a.getDisciplina() != null && a.getDisciplina().isExigeLaboratorio();
            boolean labB = b.getDisciplina() != null && b.getDisciplina().isExigeLaboratorio();
            if (labA != labB) return Boolean.compare(labB, labA);

            int capCmp = Integer.compare(b.getNumeroAlunos(), a.getNumeroAlunos());
            if (capCmp != 0) return capCmp;

            int slotsA = SigaaHorarioParser.obterConjuntoSlots(a.getHorarioSigaa()).size();
            int slotsB = SigaaHorarioParser.obterConjuntoSlots(b.getHorarioSigaa()).size();
            return Integer.compare(slotsB, slotsA);
        });
    }

    public StateSpaceSearch(List<Turma> turmasParaAlocar, List<Sala> salasDisponiveis, ValidadorDeRestricoes validador) {
        this(turmasParaAlocar, salasDisponiveis, List.of(), validador);
    }

    private Comparator<Sala> ordenarSalasSoftConstraint(Turma turma) {
        boolean exigeLab = turma.getDisciplina() != null && turma.getDisciplina().isExigeLaboratorio();
        return (s1, s2) -> {
            // Para disciplinas teóricas, preserva laboratórios evitando alocá-los antes de salas comuns
            if (!exigeLab && s1.isLaboratorio() != s2.isLaboratorio()) {
                return Boolean.compare(s1.isLaboratorio(), s2.isLaboratorio());
            }
            // Best-Fit: menor sala que comporta a turma primeiro (minimiza ociosidade)
            int capCmp = Integer.compare(s1.getCapacidade(), s2.getCapacidade());
            if (capCmp != 0) return capCmp;
            return s1.getNome().compareToIgnoreCase(s2.getNome());
        };
    }

    public ResultadoBusca solve() {
        long inicio = System.currentTimeMillis();
        this.melhorSolucaoParcial = new ArrayList<>();

        List<Alocacao> estadoAtual = new ArrayList<>(alocacoesPreExistentes);
        int baseOffset = alocacoesPreExistentes.size();

        boolean sucessoTotal = search(0, estadoAtual, baseOffset);
        long fim = System.currentTimeMillis();

        List<Alocacao> resultadoFinal;
        List<Turma> pendentes = new ArrayList<>();

        if (sucessoTotal) {
            resultadoFinal = new ArrayList<>(estadoAtual.subList(baseOffset, estadoAtual.size()));
        } else {
            // Recuperação parcial: aproveita a melhor solução parcial e tenta encaixar restantes válidas
            List<Alocacao> parcial = new ArrayList<>(alocacoesPreExistentes);
            parcial.addAll(melhorSolucaoParcial);

            Set<Turma> jaAlocadas = new HashSet<>();
            for (Alocacao a : melhorSolucaoParcial) {
                jaAlocadas.add(a.getTurma());
            }

            for (Turma t : turmasOrdenadas) {
                if (jaAlocadas.contains(t)) continue;
                boolean alocada = false;
                for (Sala s : dominioSalasPorTurma.get(t)) {
                    if (validador.isAlocacaoValida(t, s, parcial)) {
                        Alocacao nova = new Alocacao(t, s, t.getHorarioSigaa(), "RASCUNHO");
                        parcial.add(nova);
                        melhorSolucaoParcial.add(nova);
                        jaAlocadas.add(t);
                        alocada = true;
                        break;
                    }
                }
                if (!alocada) {
                    pendentes.add(t);
                }
            }
            resultadoFinal = melhorSolucaoParcial;
        }

        return new ResultadoBusca(pendentes.isEmpty() && sucessoTotal, resultadoFinal, pendentes,
                podas, nosVisitados, Math.max(1, fim - inicio));
    }

    private boolean search(int depth, List<Alocacao> estadoAtual, int baseOffset) {
        int alocadasAteAgora = estadoAtual.size() - baseOffset;
        if (alocadasAteAgora > melhorSolucaoParcial.size()) {
            melhorSolucaoParcial = new ArrayList<>(estadoAtual.subList(baseOffset, estadoAtual.size()));
        }

        if (depth == turmasOrdenadas.size()) {
            return true;
        }

        if (nosVisitados >= MAX_NOS_BUSCA) {
            return false;
        }

        nosVisitados++;
        Turma turmaAtual = turmasOrdenadas.get(depth);

        // Poda antecipada RN-02 (Indisponibilidade) e RN-01 (Choque Docente independe da sala)
        if (!validador.verificarIndisponibilidade(turmaAtual)
                || !validador.verificarChoqueProfessor(turmaAtual, estadoAtual)) {
            podas += dominioSalasPorTurma.get(turmaAtual).size();
            return false;
        }

        for (Sala salaCandidata : dominioSalasPorTurma.get(turmaAtual)) {
            if (validador.verificarChoqueSala(turmaAtual, salaCandidata, estadoAtual)) {
                Alocacao tentativa = new Alocacao(turmaAtual, salaCandidata, turmaAtual.getHorarioSigaa(), "RASCUNHO");
                estadoAtual.add(tentativa);

                if (search(depth + 1, estadoAtual, baseOffset)) {
                    return true;
                }

                estadoAtual.remove(estadoAtual.size() - 1);
            } else {
                podas++;
            }
        }

        return false;
    }
}
