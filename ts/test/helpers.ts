/** Fábricas de entidades para os testes (equivalentes aos construtores Java usados na SaticValidationSuite). */
import type { Disciplina, IndisponibilidadeDocente, Professor, Sala, Turma } from "../src/shared/tipos.ts";

export function sala(id: number | null, nome: string, capacidade: number, tipoEspaco: string, bloco: string, alocavelIc: boolean): Sala {
    return { id, nome, capacidade, tipoEspaco, bloco, alocavelIc };
}

export function professor(matriculaSiape: string, nome: string, ...indisponibilidades: Omit<IndisponibilidadeDocente, "professorMatricula">[]): Professor {
    return {
        matriculaSiape,
        nome,
        indisponibilidades: indisponibilidades.map((i) => ({ professorMatricula: matriculaSiape, ...i })),
    };
}

export function disciplina(codigo: string, nome: string, cargaHoraria: number, exigeLaboratorio: boolean): Disciplina {
    return { codigo, nome, cargaHoraria, exigeLaboratorio };
}

export function turma(
    id: number | null, disc: Disciplina, codigoTurma: string, semestre: string, cursosOfertados: string,
    horarioSigaa: string, vagas: number, matriculados: number, requerAlocacaoIc: boolean, ...profs: Professor[]
): Turma {
    const t: Turma = {
        id, disciplina: disc, professores: [], cargaHorariaPorDocente: {}, codigoTurma, semestre,
        cursosOfertados, horarioSigaa, vagas, matriculados, requerAlocacaoIc,
    };
    for (const p of profs) {
        t.professores.push(p);
        t.cargaHorariaPorDocente[p.matriculaSiape] = disc.cargaHoraria;
    }
    return t;
}

/** Executor que responde qualquer SQL com zero linhas e registra as chamadas (para mocks de repositório). */
export function executorVazio(chamadas: { sql: string; params?: unknown[] }[] = []) {
    return {
        chamadas,
        query: async (sql: string, params?: unknown[]) => {
            chamadas.push({ sql, params });
            return { rows: [], rowCount: 0 } as never;
        },
    };
}

/** Substituto de comTransacao nos testes: executa o callback com um executor vazio, sem PostgreSQL. */
export const semTransacao = <T>(fn: (db: never) => Promise<T>): Promise<T> => fn(executorVazio() as never);
