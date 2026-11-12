package service;

import model.Alocacao;
import model.IndisponibilidadeDocente;
import model.Professor;
import model.Sala;
import model.Turma;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Serviço isolado de validação das Regras de Negócio Formais (Hard Constraints) do SATIC.
 * Convenção uniforme: todos os métodos 'verificar*' retornam {@code true} quando a restrição
 * é satisfeita (alocação permitida) e {@code false} quando há violação.
 */
public class ValidadorDeRestricoes {

    /**
     * RN-01 (Sem Choque Docente):
     * Nenhum professor da turma candidata pode estar alocado simultaneamente em outra turma
     * com sobreposição de horário. Suporta co-docência (múltiplos docentes por turma).
     */
    public boolean verificarChoqueProfessor(Turma turmaCandidata, List<Alocacao> alocacoesAtuais) {
        if (turmaCandidata == null || turmaCandidata.getProfessores().isEmpty() || alocacoesAtuais == null) {
            return true;
        }

        Set<String> siapesCandidatos = new HashSet<>();
        for (Professor p : turmaCandidata.getProfessores()) {
            siapesCandidatos.add(p.getMatriculaSiape());
        }

        for (Alocacao aloc : alocacoesAtuais) {
            Turma outra = aloc.getTurma();
            if (outra == null || outra.equals(turmaCandidata)) {
                continue;
            }
            if (!SigaaHorarioParser.haSobreposicao(turmaCandidata.getHorarioSigaa(), aloc.getHorarioCodigo())) {
                continue;
            }
            for (Professor profAlocado : outra.getProfessores()) {
                if (siapesCandidatos.contains(profAlocado.getMatriculaSiape())) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * RN-02 (Respeito à Indisponibilidade Docente):
     * A alocação não pode intersectar nenhuma janela bloqueada previamente pelos docentes da turma.
     */
    public boolean verificarIndisponibilidade(Turma turmaCandidata) {
        if (turmaCandidata == null || turmaCandidata.getProfessores().isEmpty()) {
            return true;
        }

        Set<String> slotsTurma = SigaaHorarioParser.obterConjuntoSlots(turmaCandidata.getHorarioSigaa());
        for (Professor prof : turmaCandidata.getProfessores()) {
            for (IndisponibilidadeDocente ind : prof.getIndisponibilidades()) {
                for (String slotBloqueado : ind.toSlotsAtomicos()) {
                    if (slotsTurma.contains(slotBloqueado)) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    /**
     * RN-03 (Capacidade Física):
     * Turma.numeroAlunos <= Sala.capacidade.
     */
    public boolean verificarCapacidade(Turma turmaCandidata, Sala sala) {
        if (turmaCandidata == null || sala == null) {
            return false;
        }
        return turmaCandidata.getNumeroAlunos() <= sala.getCapacidade();
    }

    /**
     * RN-04 (Adequação de Infraestrutura):
     * Disciplinas com exigeLaboratorio = true exigem espaço com tipoEspaco = "Laboratório".
     */
    public boolean verificarRequisitoLab(Turma turmaCandidata, Sala sala) {
        if (turmaCandidata == null || turmaCandidata.getDisciplina() == null || sala == null) {
            return false;
        }
        if (turmaCandidata.getDisciplina().isExigeLaboratorio()) {
            return sala.isLaboratorio();
        }
        return true;
    }

    /**
     * Exclusividade de Espaço Físico (Sem Choque de Sala):
     * Uma mesma sala não pode receber duas turmas com sobreposição de horário.
     */
    public boolean verificarChoqueSala(Turma turmaCandidata, Sala sala, List<Alocacao> alocacoesAtuais) {
        if (turmaCandidata == null || sala == null || alocacoesAtuais == null) {
            return true;
        }
        for (Alocacao aloc : alocacoesAtuais) {
            if (aloc.getSala() == null || !aloc.getSala().equals(sala)) {
                continue;
            }
            if (aloc.getTurma() != null && aloc.getTurma().equals(turmaCandidata)) {
                continue;
            }
            if (SigaaHorarioParser.haSobreposicao(turmaCandidata.getHorarioSigaa(), aloc.getHorarioCodigo())) {
                return false;
            }
        }
        return true;
    }

    /**
     * Valida simultaneamente todas as restrições rígidas para uma alocação proposta.
     */
    public boolean isAlocacaoValida(Turma turmaCandidata, Sala sala, List<Alocacao> alocacoesAtuais) {
        return verificarCapacidade(turmaCandidata, sala)
                && verificarRequisitoLab(turmaCandidata, sala)
                && verificarIndisponibilidade(turmaCandidata)
                && verificarChoqueSala(turmaCandidata, sala, alocacoesAtuais)
                && verificarChoqueProfessor(turmaCandidata, alocacoesAtuais);
    }

    /**
     * Retorna diagnósticos legíveis de todas as violações encontradas para feedback à secretaria.
     */
    public List<String> diagnosticarViolacoes(Turma turmaCandidata, Sala sala, List<Alocacao> alocacoesAtuais) {
        List<String> violacoes = new ArrayList<>();
        if (!verificarCapacidade(turmaCandidata, sala)) {
            violacoes.add(String.format("RN-03 Lotação: turma com %d alunos excede capacidade de %s (%d lugares).",
                    turmaCandidata.getNumeroAlunos(), sala.getNome(), sala.getCapacidade()));
        }
        if (!verificarRequisitoLab(turmaCandidata, sala)) {
            violacoes.add(String.format("RN-04 Infraestrutura: %s exige laboratório, mas %s não possui perfil de laboratório.",
                    turmaCandidata.getDisciplina().getCodigo(), sala.getNome()));
        }
        if (!verificarIndisponibilidade(turmaCandidata)) {
            violacoes.add("RN-02 Indisponibilidade: horário da turma conflita com bloqueio cadastrado do docente.");
        }
        if (!verificarChoqueSala(turmaCandidata, sala, alocacoesAtuais)) {
            violacoes.add(String.format("Choque de Sala: %s já está ocupada no horário %s.",
                    sala.getNome(), turmaCandidata.getHorarioSigaa()));
        }
        if (!verificarChoqueProfessor(turmaCandidata, alocacoesAtuais)) {
            violacoes.add(String.format("RN-01 Choque Docente: professor já alocado em outra turma no horário %s.",
                    turmaCandidata.getHorarioSigaa()));
        }
        return violacoes;
    }
}
