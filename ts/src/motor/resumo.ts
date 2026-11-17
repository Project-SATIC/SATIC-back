/**
 * Serialização do resultado do motor no mesmo formato do gabarito gerado pelo Java
 * (tools/GoldenDump.java), usada no teste de equivalência e pelo script `npm run motor`.
 */
import { chaveTurma } from "../shared/tipos.ts";
import type { Alocacao, Turma } from "../shared/tipos.ts";
import type { ResultadoBusca } from "./state-space-search.ts";

export interface ResumoMotor {
    completo: boolean;
    nosVisitados: number;
    podas: number;
    turmas: { chave: string; cursos: string; horario: string; siapes: string[] }[];
    reservas: { turma: string; sala: string }[];
    alocacoes: { turma: string; sala: string; horario: string; status: string }[];
    pendentes: string[];
}

export function resumir(todasTurmas: readonly Turma[], reservas: readonly Alocacao[], r: ResultadoBusca): ResumoMotor {
    return {
        completo: r.completo,
        nosVisitados: r.nosVisitados,
        podas: r.podas,
        turmas: todasTurmas.map((t) => ({
            chave: chaveTurma(t),
            cursos: t.cursosOfertados,
            horario: t.horarioSigaa,
            siapes: t.professores.map((p) => p.matriculaSiape),
        })),
        reservas: reservas.map((a) => ({ turma: chaveTurma(a.turma), sala: a.sala.nome })),
        alocacoes: r.alocacoes.map((a) => ({ turma: chaveTurma(a.turma), sala: a.sala.nome, horario: a.horarioCodigo, status: a.status })),
        pendentes: r.turmasPendentes.map(chaveTurma),
    };
}
