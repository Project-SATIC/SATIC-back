import { comTransacao, executarQuery, type QueryExecutor } from "../connection.ts";
import type { Disciplina, Turma } from "../../shared/tipos.ts";
import { hidratarProfessoresEmTurmas } from "./hidratar-professores.ts";

interface TurmaRow {
    t_id: number;
    t_codigo: string;
    t_semestre: string;
    t_cursos: string;
    t_vagas: number;
    t_matriculados: number;
    t_requer_ic: boolean;
    t_horario: string;
    d_codigo: string;
    d_nome: string;
    d_ch: number;
    d_lab: boolean;
}

export class TurmaRepository {
    async inserir(turma: Turma, executor?: QueryExecutor): Promise<Turma> {
        const executar = async (tx: QueryExecutor): Promise<Turma> => {
            const sqlTurma = `
                INSERT INTO turma (
                    id_disciplina, codigo_turma, semestre, cursos_ofertados,
                    vagas, matriculados, requer_alocacao_ic, horario_sigaa
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (semestre, id_disciplina, codigo_turma) DO UPDATE
                SET cursos_ofertados = EXCLUDED.cursos_ofertados,
                    vagas = EXCLUDED.vagas,
                    matriculados = EXCLUDED.matriculados,
                    requer_alocacao_ic = EXCLUDED.requer_alocacao_ic,
                    horario_sigaa = EXCLUDED.horario_sigaa
                RETURNING id;
            `;

            const res = await executarQuery<{ id: number }>(
                sqlTurma,
                [
                    turma.disciplina.codigo,
                    turma.codigoTurma,
                    turma.semestre,
                    turma.cursosOfertados,
                    turma.vagas,
                    turma.matriculados,
                    turma.requerAlocacaoIc,
                    turma.horarioSigaa,
                ],
                tx
            );

            const turmaId = Number(res.rows[0].id);
            turma.id = turmaId;

            // Atualiza vínculos com professores
            await executarQuery("DELETE FROM professor_turma WHERE id_turma = $1;", [turmaId], tx);

            const sqlVinculo = `
                INSERT INTO professor_turma (matricula_siape, id_turma, carga_horaria_professor)
                VALUES ($1, $2, $3)
                ON CONFLICT (matricula_siape, id_turma) DO UPDATE
                SET carga_horaria_professor = EXCLUDED.carga_horaria_professor;
            `;

            for (const prof of turma.professores) {
                const carga = turma.cargaHorariaPorDocente?.[prof.matriculaSiape] ?? turma.disciplina.cargaHoraria;
                await executarQuery(sqlVinculo, [prof.matriculaSiape, turmaId, carga], tx);
            }

            return turma;
        };

        if (executor) {
            return executar(executor);
        }
        return comTransacao((client) => executar(client));
    }

    async inserirMuitas(turmas: readonly Turma[], executor?: QueryExecutor): Promise<void> {
        const executar = async (tx: QueryExecutor): Promise<void> => {
            for (const turma of turmas) {
                await this.inserir(turma, tx);
            }
        };

        if (executor) {
            await executar(executor);
            return;
        }
        await comTransacao((client) => executar(client));
    }

    async buscarPorId(id: number, executor?: QueryExecutor): Promise<Turma | null> {
        const sql = `
            SELECT t.id AS t_id, t.codigo_turma AS t_codigo, t.semestre AS t_semestre,
                   t.cursos_ofertados AS t_cursos, t.vagas AS t_vagas,
                   t.matriculados AS t_matriculados, t.requer_alocacao_ic AS t_requer_ic,
                   t.horario_sigaa AS t_horario,
                   d.codigo AS d_codigo, d.nome AS d_nome, d.carga_horaria AS d_ch, d.exige_laboratorio AS d_lab
            FROM turma t
            JOIN disciplina d ON t.id_disciplina = d.codigo
            WHERE t.id = $1;
        `;
        const res = await executarQuery<TurmaRow>(sql, [id], executor);
        if (res.rows.length === 0) return null;

        const turmas = await this.mapearEHidratar(res.rows, executor);
        return turmas[0] || null;
    }

    async listarPorSemestre(semestre: string, executor?: QueryExecutor): Promise<Turma[]> {
        const sql = `
            SELECT t.id AS t_id, t.codigo_turma AS t_codigo, t.semestre AS t_semestre,
                   t.cursos_ofertados AS t_cursos, t.vagas AS t_vagas,
                   t.matriculados AS t_matriculados, t.requer_alocacao_ic AS t_requer_ic,
                   t.horario_sigaa AS t_horario,
                   d.codigo AS d_codigo, d.nome AS d_nome, d.carga_horaria AS d_ch, d.exige_laboratorio AS d_lab
            FROM turma t
            JOIN disciplina d ON t.id_disciplina = d.codigo
            WHERE t.semestre = $1
            ORDER BY d.codigo ASC, t.codigo_turma ASC;
        `;
        const res = await executarQuery<TurmaRow>(sql, [semestre], executor);
        return this.mapearEHidratar(res.rows, executor);
    }

    async listarTodas(executor?: QueryExecutor): Promise<Turma[]> {
        const sql = `
            SELECT t.id AS t_id, t.codigo_turma AS t_codigo, t.semestre AS t_semestre,
                   t.cursos_ofertados AS t_cursos, t.vagas AS t_vagas,
                   t.matriculados AS t_matriculados, t.requer_alocacao_ic AS t_requer_ic,
                   t.horario_sigaa AS t_horario,
                   d.codigo AS d_codigo, d.nome AS d_nome, d.carga_horaria AS d_ch, d.exige_laboratorio AS d_lab
            FROM turma t
            JOIN disciplina d ON t.id_disciplina = d.codigo
            ORDER BY t.semestre DESC, d.codigo ASC, t.codigo_turma ASC;
        `;
        const res = await executarQuery<TurmaRow>(sql, undefined, executor);
        return this.mapearEHidratar(res.rows, executor);
    }

    private async mapearEHidratar(turmaRows: TurmaRow[], executor?: QueryExecutor): Promise<Turma[]> {
        if (turmaRows.length === 0) return [];

        const turmas: Turma[] = turmaRows.map((r) => {
            const disc: Disciplina = {
                codigo: r.d_codigo,
                nome: r.d_nome,
                cargaHoraria: Number(r.d_ch),
                exigeLaboratorio: Boolean(r.d_lab),
            };

            return {
                id: Number(r.t_id),
                disciplina: disc,
                codigoTurma: r.t_codigo,
                semestre: r.t_semestre,
                cursosOfertados: r.t_cursos,
                vagas: Number(r.t_vagas),
                matriculados: Number(r.t_matriculados),
                requerAlocacaoIc: Boolean(r.t_requer_ic),
                horarioSigaa: r.t_horario,
                professores: [],
                cargaHorariaPorDocente: {},
            };
        });

        await hidratarProfessoresEmTurmas(turmas, executor);
        return turmas;
    }
}
