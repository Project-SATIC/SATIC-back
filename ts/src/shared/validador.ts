/**
 * Validação das restrições rígidas do SATIC (porte de service/ValidadorDeRestricoes.java).
 *
 * Módulo puro (sem APIs do Node) para ser executado tanto no servidor quanto no navegador:
 * o front bloqueia combinações inválidas na hora e o back valida de novo na confirmação.
 *
 * Convenção mantida do Java: todo `verificar*` retorna true quando a regra é satisfeita
 * e false quando há violação.
 *
 * Diferenças em relação ao Java (sem efeito no motor de busca):
 *  - O horário da turma candidata pode ser informado explicitamente (parâmetro `horario`),
 *    necessário para validar um encontro remanejado antes de confirmá-lo. Por padrão é
 *    `turma.horarioSigaa`, como no Java.
 *  - Nova checagem de escopo espacial (verificarEscopoEspacial), recomendada na seção 4.2
 *    do ANALISE_PROJETO.md para chamadas diretas pela API.
 *  - O diagnóstico devolve objetos { regra, mensagem } em vez de strings.
 *  - O diagnóstico inclui as regras de formato do horário (FORMATO: nº de aulas e um bloco por dia;
 *    TURNO: turnos do curso), definidas em grade.ts. O motor de salas não usa essas regras, porque
 *    não muda horários.
 */
import { haSobreposicao, obterConjuntoSlots, slotsDaIndisponibilidade } from "./horario-sigaa.ts";
import { isLaboratorio, mesmaSala, mesmaTurma, numeroAlunos } from "./tipos.ts";
import { verificarFormatoHorario } from "./grade.ts";
import type { Alocacao, Sala, Turma } from "./tipos.ts";

export type CodigoRegra = "RN-01" | "RN-02" | "RN-03" | "RN-04" | "SALA" | "ESCOPO" | "FORMATO" | "TURNO" | "EXTERNA_FIXA";

export interface Violacao {
    regra: CodigoRegra;
    mensagem: string;
}

/** RN-01: nenhum professor da turma pode estar em outra turma alocada com horário sobreposto (co-docência inclusa). */
export function verificarChoqueProfessor(
    turma: Turma | null | undefined,
    alocacoesAtuais: readonly Alocacao[] | null | undefined,
    horario: string = turma?.horarioSigaa ?? "",
): boolean {
    if (!turma || turma.professores.length === 0 || !alocacoesAtuais) return true;
    const siapes = new Set(turma.professores.map((p) => p.matriculaSiape));
    for (const aloc of alocacoesAtuais) {
        const outra = aloc.turma;
        if (!outra || mesmaTurma(outra, turma)) continue;
        if (!haSobreposicao(horario, aloc.horarioCodigo)) continue;
        for (const prof of outra.professores) {
            if (siapes.has(prof.matriculaSiape)) return false;
        }
    }
    return true;
}

/** RN-02: o horário não pode cair numa janela bloqueada de nenhum docente da turma. */
export function verificarIndisponibilidade(
    turma: Turma | null | undefined,
    horario: string = turma?.horarioSigaa ?? "",
): boolean {
    if (!turma || turma.professores.length === 0) return true;
    const slotsTurma = obterConjuntoSlots(horario);
    for (const prof of turma.professores) {
        for (const ind of prof.indisponibilidades ?? []) {
            for (const slot of slotsDaIndisponibilidade(ind)) {
                if (slotsTurma.has(slot)) return false;
            }
        }
    }
    return true;
}

/** RN-03: numeroAlunos(turma) <= sala.capacidade. */
export function verificarCapacidade(turma: Turma | null | undefined, sala: Sala | null | undefined): boolean {
    if (!turma || !sala) return false;
    return numeroAlunos(turma) <= sala.capacidade;
}

/** RN-04: disciplina que exige laboratório só pode ir para espaço do tipo "Laboratório". */
export function verificarRequisitoLab(turma: Turma | null | undefined, sala: Sala | null | undefined): boolean {
    if (!turma || !turma.disciplina || !sala) return false;
    return turma.disciplina.exigeLaboratorio ? isLaboratorio(sala) : true;
}

/** Exclusividade de sala: a mesma sala não recebe duas turmas com horários sobrepostos. */
export function verificarChoqueSala(
    turma: Turma | null | undefined,
    sala: Sala | null | undefined,
    alocacoesAtuais: readonly Alocacao[] | null | undefined,
    horario: string = turma?.horarioSigaa ?? "",
): boolean {
    if (!turma || !sala || !alocacoesAtuais) return true;
    for (const aloc of alocacoesAtuais) {
        if (!aloc.sala || !mesmaSala(aloc.sala, sala)) continue;
        if (aloc.turma && mesmaTurma(aloc.turma, turma)) continue;
        if (haSobreposicao(horario, aloc.horarioCodigo)) return false;
    }
    return true;
}

/**
 * Escopo espacial: turma que o IC aloca (requerAlocacaoIc) só pode ir para sala do pool do IC (alocavelIc).
 * Turmas externas não são barradas aqui: elas entram como reservas EXTERNA_FIXA.
 */
export function verificarEscopoEspacial(turma: Turma | null | undefined, sala: Sala | null | undefined): boolean {
    if (!turma || !sala) return false;
    return !turma.requerAlocacaoIc || sala.alocavelIc;
}

/** Todas as restrições rígidas de uma vez. */
export function isAlocacaoValida(
    turma: Turma,
    sala: Sala,
    alocacoesAtuais: readonly Alocacao[],
    horario: string = turma.horarioSigaa,
): boolean {
    return verificarCapacidade(turma, sala)
        && verificarRequisitoLab(turma, sala)
        && verificarEscopoEspacial(turma, sala)
        && verificarIndisponibilidade(turma, horario)
        && verificarChoqueSala(turma, sala, alocacoesAtuais, horario)
        && verificarChoqueProfessor(turma, alocacoesAtuais, horario);
}

/** Lista legível de todas as violações (para a secretaria e para a resposta 409 da API). */
export function diagnosticarViolacoes(
    turma: Turma,
    sala: Sala,
    alocacoesAtuais: readonly Alocacao[],
    horario: string = turma.horarioSigaa,
): Violacao[] {
    const v: Violacao[] = [];
    if (!verificarCapacidade(turma, sala)) {
        v.push({ regra: "RN-03", mensagem: `RN-03 Lotação: turma com ${numeroAlunos(turma)} alunos excede capacidade de ${sala.nome} (${sala.capacidade} lugares).` });
    }
    if (!verificarRequisitoLab(turma, sala)) {
        v.push({ regra: "RN-04", mensagem: `RN-04 Infraestrutura: ${turma.disciplina.codigo} exige laboratório, mas ${sala.nome} não possui perfil de laboratório.` });
    }
    if (!verificarEscopoEspacial(turma, sala)) {
        v.push({ regra: "ESCOPO", mensagem: `Escopo espacial: ${sala.nome} (bloco ${sala.bloco}) não pertence ao pool de alocação do IC.` });
    }
    if (!verificarIndisponibilidade(turma, horario)) {
        v.push({ regra: "RN-02", mensagem: "RN-02 Indisponibilidade: horário da turma conflita com bloqueio cadastrado do docente." });
    }
    if (!verificarChoqueSala(turma, sala, alocacoesAtuais, horario)) {
        v.push({ regra: "SALA", mensagem: `Choque de Sala: ${sala.nome} já está ocupada no horário ${horario}.` });
    }
    if (!verificarChoqueProfessor(turma, alocacoesAtuais, horario)) {
        v.push({ regra: "RN-01", mensagem: `RN-01 Choque Docente: professor já alocado em outra turma no horário ${horario}.` });
    }
    for (const p of verificarFormatoHorario(turma, horario)) v.push(p);
    return v;
}

function cmpBool(a: boolean, b: boolean): number {
    return a === b ? 0 : a ? 1 : -1;
}

function cmpNum(a: number, b: number): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** Character.toUpperCase/toLowerCase nunca expandem; ignora mapeamentos de vários caracteres (ex: ß). */
function umCaractere(convertido: string, original: number): number {
    return convertido.length === 1 ? convertido.charCodeAt(0) : original;
}

/** String.compareToIgnoreCase do Java (compara caractere a caractere, maiúsculo e depois minúsculo). */
export function compareToIgnoreCase(a: string, b: string): number {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        let c1 = a.charCodeAt(i);
        let c2 = b.charCodeAt(i);
        if (c1 === c2) continue;
        c1 = umCaractere(String.fromCharCode(c1).toUpperCase(), c1);
        c2 = umCaractere(String.fromCharCode(c2).toUpperCase(), c2);
        if (c1 === c2) continue;
        c1 = umCaractere(String.fromCharCode(c1).toLowerCase(), c1);
        c2 = umCaractere(String.fromCharCode(c2).toLowerCase(), c2);
        if (c1 !== c2) return c1 - c2;
    }
    return a.length - b.length;
}

/** Soft constraint do motor (compartilhada entre motor, remanejamento e front-end). */
export function ordenarSalasSoftConstraint(turma: Turma): (s1: Sala, s2: Sala) => number {
    const lab = turma.disciplina != null && turma.disciplina.exigeLaboratorio;
    return (s1, s2) => {
        // Turmas teóricas: salas comuns antes de laboratórios
        if (!lab && isLaboratorio(s1) !== isLaboratorio(s2)) {
            return cmpBool(isLaboratorio(s1), isLaboratorio(s2));
        }
        // Best-Fit: menor sala que comporta a turma primeiro
        const cap = cmpNum(s1.capacidade, s2.capacidade);
        if (cap !== 0) return cap;
        return compareToIgnoreCase(s1.nome, s2.nome);
    };
}
