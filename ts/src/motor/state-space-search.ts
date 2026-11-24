/**
 * Motor de busca em espaço de estados (porte de StateSpaceSearch.java).
 *
 * Backtracking com poda antecipada, ordenação MRV das turmas, Best-Fit nas salas
 * (soft constraint que preserva laboratórios para turmas teóricas) e recuperação
 * parcial gulosa quando não existe solução completa ou o limite de nós é atingido.
 */
import { obterConjuntoSlots } from "../shared/horario-sigaa.ts";
import { numeroAlunos } from "../shared/tipos.ts";
import type { Alocacao, Sala, Turma } from "../shared/tipos.ts";
import {
    compareToIgnoreCase,
    isAlocacaoValida,
    ordenarSalasSoftConstraint,
    verificarCapacidade,
    verificarChoqueProfessor,
    verificarChoqueSala,
    verificarIndisponibilidade,
    verificarRequisitoLab,
} from "../shared/validador.ts";

export { compareToIgnoreCase, ordenarSalasSoftConstraint };

export interface ResultadoBusca {
    completo: boolean;
    alocacoes: Alocacao[];
    turmasPendentes: Turma[];
    podas: number;
    nosVisitados: number;
    tempoMs: number;
}

export const MAX_NOS_BUSCA = 300_000;

function cmpBool(a: boolean, b: boolean): number {
    return a === b ? 0 : a ? 1 : -1;
}

function cmpNum(a: number, b: number): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function exigeLab(turma: Turma): boolean {
    return turma.disciplina != null && turma.disciplina.exigeLaboratorio;
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
