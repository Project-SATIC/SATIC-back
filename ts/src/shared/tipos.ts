/**
 * Tipos de domínio do SATIC (porte de src/model/*.java).
 *
 * São objetos de dados simples (serializáveis em JSON) para que o mesmo contrato seja
 * usado pelo servidor Express e pelo front-end. As regras derivadas que no Java eram
 * métodos das entidades (getNumeroAlunos, isLaboratorio, equals) ficam como funções puras.
 */

export type DiaSemana = "SEG" | "TER" | "QUA" | "QUI" | "SEX" | "SAB";
export type Turno = "M" | "T" | "N";
export type StatusAlocacao = "RASCUNHO" | "DEFINITIVA" | "EXTERNA_FIXA";

export interface Disciplina {
    codigo: string;
    nome: string;
    cargaHoraria: number;
    /** RN-04: true se requer laboratório. */
    exigeLaboratorio: boolean;
}

/** Janela bloqueada de um docente (RN-02). diaSemana aceita "SEG".."SAB" ou "2".."7". */
export interface IndisponibilidadeDocente {
    id?: number | null;
    professorMatricula: string;
    diaSemana: string;
    turno: string;
    /** Índices das aulas no turno, ex: "56". */
    indiceHorario: string;
}

export interface Professor {
    matriculaSiape: string;
    nome: string;
    indisponibilidades: IndisponibilidadeDocente[];
}

export interface Sala {
    id?: number | null;
    nome: string;
    capacidade: number;
    /** "Sala", "Laboratório" ou "Auditório". */
    tipoEspaco: string;
    /** "IC", "BL12", "IM", "CTEC" ou "IF". */
    bloco: string;
    alocavelIc: boolean;
}

export interface Turma {
    id?: number | null;
    disciplina: Disciplina;
    /** Co-docência N:M. */
    professores: Professor[];
    /** Carga horária de cada docente, indexada pela matrícula SIAPE. */
    cargaHorariaPorDocente: Record<string, number>;
    codigoTurma: string;
    semestre: string;
    /** Ex: "CC", "EC" ou "CC, EC" para turmas conjuntas. */
    cursosOfertados: string;
    /** Notação SIGAA, ex: "35M34" ou "2T56 6T12". */
    horarioSigaa: string;
    vagas: number;
    matriculados: number;
    /** false para turmas ministradas em outros institutos (CTEC/IF). */
    requerAlocacaoIc: boolean;
    /**
     * Aulas de 50 min por semana. Fica no cadastro para a turma continuar sabendo quantas aulas
     * precisa mesmo quando está sem horário (pendente). Ausente: vale o número de aulas do horário.
     */
    aulasSemanais?: number | null;
}

export interface Alocacao {
    id?: number | null;
    turma: Turma;
    sala: Sala;
    /** Horário efetivamente ocupado; pode diferir de turma.horarioSigaa após um remanejamento confirmado. */
    horarioCodigo: string;
    status: StatusAlocacao;
    dataGeracao?: string | null;
}

/** Demanda efetiva usada no RN-03: matriculados > 0 ? matriculados : vagas. */
export function numeroAlunos(turma: Turma): number {
    return turma.matriculados > 0 ? turma.matriculados : turma.vagas;
}

/** Derivado de tipoEspaco (aceita com ou sem acento, sem diferenciar maiúsculas). */
export function isLaboratorio(sala: Sala): boolean {
    const tipo = sala.tipoEspaco?.toLowerCase();
    return tipo === "laboratório" || tipo === "laboratorio";
}

/** Igualdade de Turma.equals(): por id quando ambos existem; senão pela chave natural. */
export function mesmaTurma(a: Turma | null | undefined, b: Turma | null | undefined): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.id != null && b.id != null) return a.id === b.id;
    return a.semestre === b.semestre
        && a.disciplina?.codigo === b.disciplina?.codigo
        && a.codigoTurma === b.codigoTurma;
}

/** Igualdade de Sala.equals(): pelo nome (UNIQUE) quando ambos existem; senão por id. */
export function mesmaSala(a: Sala | null | undefined, b: Sala | null | undefined): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.nome != null && b.nome != null) return a.nome === b.nome;
    return a.id != null && a.id === b.id;
}

/** Chave legível "CODIGO-TURMA", ex: "COMP373-02". */
export function chaveTurma(turma: Turma): string {
    return `${turma.disciplina.codigo}-${turma.codigoTurma}`;
}

export function identificadorExibicao(turma: Turma): string {
    return `[${turma.disciplina.codigo}] ${turma.disciplina.nome} (T${turma.codigoTurma}) [${turma.cursosOfertados}]`;
}
