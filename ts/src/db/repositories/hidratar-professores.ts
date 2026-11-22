import { executarQuery, type QueryExecutor } from "../connection.ts";
import type { Professor, Turma } from "../../shared/tipos.ts";
import { parseHorarioIndisponivel } from "./professor.repository.ts";

export interface ProfessorTurmaRow {
    id_turma: number;
    matricula_siape: string;
    nome_docente: string;
    carga_horaria_professor: number;
    horario_indisponivel: string | null;
}

export function aplicarProfessoresEmTurmas(
    turmas: readonly Turma[],
    rows: readonly ProfessorTurmaRow[]
): void {
    const profsPorTurma = new Map<number, Map<string, Professor>>();
    const cargaPorTurma = new Map<number, Record<string, number>>();

    for (const row of rows) {
        const turmaId = Number(row.id_turma);
        let mapaProfs = profsPorTurma.get(turmaId);
        if (!mapaProfs) {
            mapaProfs = new Map();
            profsPorTurma.set(turmaId, mapaProfs);
        }

        let prof = mapaProfs.get(row.matricula_siape);
        if (!prof) {
            prof = {
                matriculaSiape: row.matricula_siape,
                nome: row.nome_docente,
                indisponibilidades: [],
            };
            mapaProfs.set(row.matricula_siape, prof);
        }

        if (row.horario_indisponivel) {
            const ind = parseHorarioIndisponivel(row.matricula_siape, row.horario_indisponivel);
            if (
                !prof.indisponibilidades.some(
                    (i) =>
                        i.diaSemana === ind.diaSemana &&
                        i.turno === ind.turno &&
                        i.indiceHorario === ind.indiceHorario
                )
            ) {
                prof.indisponibilidades.push(ind);
            }
        }

        let cargas = cargaPorTurma.get(turmaId);
        if (!cargas) {
            cargas = {};
            cargaPorTurma.set(turmaId, cargas);
        }
        cargas[row.matricula_siape] = Number(row.carga_horaria_professor);
    }

    for (const turma of turmas) {
        if (turma.id == null) continue;
        const profsMap = profsPorTurma.get(Number(turma.id));
        turma.professores = profsMap ? Array.from(profsMap.values()) : [];
        turma.cargaHorariaPorDocente = cargaPorTurma.get(Number(turma.id)) || {};
    }
}

export async function hidratarProfessoresEmTurmas(
    turmas: readonly Turma[],
    executor?: QueryExecutor
): Promise<void> {
    const turmaIds = Array.from(
        new Set(turmas.filter((t) => t.id != null).map((t) => Number(t.id)))
    );
    if (turmaIds.length === 0) return;

    const sqlDocentes = `
        SELECT pt.id_turma, pt.matricula_siape, pt.carga_horaria_professor,
               p.nome AS nome_docente,
               rh.horario_indisponivel
        FROM professor_turma pt
        JOIN professor p ON pt.matricula_siape = p.matricula_siape
        LEFT JOIN restricoes_horario rh ON p.matricula_siape = rh.matricula_siape
        WHERE pt.id_turma = ANY($1::int[])
        ORDER BY p.nome ASC;
    `;

    const resDocentes = await executarQuery<ProfessorTurmaRow>(sqlDocentes, [turmaIds], executor);
    aplicarProfessoresEmTurmas(turmas, resDocentes.rows);
}
