/**
 * Motor de busca em espaço de estados (porte de StateSpaceSearch.java).
 *
 * Backtracking com poda antecipada, ordenação MRV das turmas, Best-Fit nas salas
 * (soft constraint que preserva laboratórios para turmas teóricas) e recuperação
 * parcial gulosa quando não existe solução completa ou o limite de nós é atingido.
 */
import { obterConjuntoSlots } from "../shared/horario-sigaa.ts";
import { isLaboratorio, numeroAlunos } from "../shared/tipos.ts";
import type { Alocacao, Sala, Turma } from "../shared/tipos.ts";
import {
    isAlocacaoValida,
    verificarCapacidade,
    verificarChoqueProfessor,
    verificarChoqueSala,
    verificarIndisponibilidade,
    verificarRequisitoLab,
} from "../shared/validador.ts";

export interface ResultadoBusca {
    completo: boolean;
    alocacoes: Alocacao[];
    turmasPendentes: Turma[];
    podas: number;
    nosVisitados: number;
    tempoMs: number;
}

export const MAX_NOS_BUSCA = 300_000;

/** Boolean.compare do Java: false < true. */
function cmpBool(a: boolean, b: boolean): number {
    return a === b ? 0 : a ? 1 : -1;
}

function cmpNum(a: number, b: number): number {
    return a < b ? -1 : a > b ? 1 : 0;
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

/** Character.toUpperCase/toLowerCase nunca expandem; ignora mapeamentos de vários caracteres (ex: ß). */
function umCaractere(convertido: string, original: number): number {
    return convertido.length === 1 ? convertido.charCodeAt(0) : original;
}

function exigeLab(turma: Turma): boolean {
    return turma.disciplina != null && turma.disciplina.exigeLaboratorio;
}

/** Soft constraint do motor (exportada para o remanejamento escolher sala pelo mesmo critério). */
export function ordenarSalasSoftConstraint(turma: Turma): (s1: Sala, s2: Sala) => number {
    const lab = exigeLab(turma);
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

export class StateSpaceSearch {
    readonly #turmasOrdenadas: Turma[];
    readonly #dominio = new Map<Turma, Sala[]>();
    readonly #preExistentes: readonly Alocacao[];
    readonly #maxNos: number;
    #podas = 0;
    #nosVisitados = 0;
    #melhorParcial: Alocacao[] = [];

    constructor(
        turmasParaAlocar: readonly Turma[],
        salasDisponiveis: readonly Sala[],
        alocacoesPreExistentes: readonly Alocacao[] = [],
        opcoes: { maxNos?: number } = {},
    ) {
        this.#preExistentes = alocacoesPreExistentes ?? [];
        this.#maxNos = opcoes.maxNos ?? MAX_NOS_BUSCA;

        // Domínio estático (RN-03 + RN-04) ordenado pela soft constraint
        for (const t of turmasParaAlocar) {
            const candidatas: Sala[] = [];
            for (const s of salasDisponiveis) {
                if (verificarCapacidade(t, s) && verificarRequisitoLab(t, s)) candidatas.push(s);
                else this.#podas++;
            }
            candidatas.sort(ordenarSalasSoftConstraint(t));
            this.#dominio.set(t, candidatas);
        }

        // MRV: menor domínio, exige lab, mais alunos, mais slots
        this.#turmasOrdenadas = [...turmasParaAlocar].sort((a, b) => {
            const dom = cmpNum(this.#dominio.get(a)!.length, this.#dominio.get(b)!.length);
            if (dom !== 0) return dom;
            const lab = cmpBool(exigeLab(b), exigeLab(a));
            if (lab !== 0) return lab;
            const cap = cmpNum(numeroAlunos(b), numeroAlunos(a));
            if (cap !== 0) return cap;
            return cmpNum(obterConjuntoSlots(b.horarioSigaa).size, obterConjuntoSlots(a.horarioSigaa).size);
        });
    }

    solve(): ResultadoBusca {
        const inicio = performance.now();
        this.#melhorParcial = [];

        const estado: Alocacao[] = [...this.#preExistentes];
        const base = this.#preExistentes.length;
        const sucessoTotal = this.#search(0, estado, base);
        const fim = performance.now();

        const pendentes: Turma[] = [];
        let resultado: Alocacao[];

        if (sucessoTotal) {
            resultado = estado.slice(base);
        } else {
            // Recuperação parcial: parte da melhor solução parcial e encaixa as restantes de forma gulosa
            const parcial: Alocacao[] = [...this.#preExistentes, ...this.#melhorParcial];
            const jaAlocadas = new Set(this.#melhorParcial.map((a) => a.turma));
            for (const t of this.#turmasOrdenadas) {
                if (jaAlocadas.has(t)) continue;
                let alocada = false;
                for (const s of this.#dominio.get(t)!) {
                    if (isAlocacaoValida(t, s, parcial)) {
                        const nova: Alocacao = { turma: t, sala: s, horarioCodigo: t.horarioSigaa, status: "RASCUNHO" };
                        parcial.push(nova);
                        this.#melhorParcial.push(nova);
                        jaAlocadas.add(t);
                        alocada = true;
                        break;
                    }
                }
                if (!alocada) pendentes.push(t);
            }
            resultado = this.#melhorParcial;
        }

        return {
            completo: pendentes.length === 0 && sucessoTotal,
            alocacoes: resultado,
            turmasPendentes: pendentes,
            podas: this.#podas,
            nosVisitados: this.#nosVisitados,
            tempoMs: Math.max(1, Math.round(fim - inicio)),
        };
    }

    #search(depth: number, estado: Alocacao[], base: number): boolean {
        if (estado.length - base > this.#melhorParcial.length) {
            this.#melhorParcial = estado.slice(base);
        }
        if (depth === this.#turmasOrdenadas.length) return true;
        if (this.#nosVisitados >= this.#maxNos) return false;

        this.#nosVisitados++;
        const turma = this.#turmasOrdenadas[depth];
        const dominio = this.#dominio.get(turma)!;

        // Poda antecipada: RN-02 e RN-01 independem da sala escolhida
        if (!verificarIndisponibilidade(turma) || !verificarChoqueProfessor(turma, estado)) {
            this.#podas += dominio.length;
            return false;
        }

        for (const sala of dominio) {
            if (verificarChoqueSala(turma, sala, estado)) {
                estado.push({ turma, sala, horarioCodigo: turma.horarioSigaa, status: "RASCUNHO" });
                if (this.#search(depth + 1, estado, base)) return true;
                estado.pop();
            } else {
                this.#podas++;
            }
        }
        return false;
    }
}
