import { getClient, query } from "../connection.ts";
import type { Disciplina, Professor, Turma } from "../../shared/tipos.ts";
import { parseHorarioIndisponivel } from "./professor.repository.ts";

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

interface ProfessorTurmaRow {
    id_turma: number;
    matricula_siape: string;
    nome_docente: string;
    carga_horaria_professor: number;
    horario_indisponivel: string | null;
}

export class TurmaRepository {
    async inserir(turma: Turma): Promise<Turma> {
        const client = await getClient();
        try {
            await client.query("BEGIN;");

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

            const res = await client.query<{ id: number }>(sqlTurma, [
                turma.disciplina.codigo,
                turma.codigoTurma,
                turma.semestre,
                turma.cursosOfertados,
                turma.vagas,
                turma.matriculados,
                turma.requerAlocacaoIc,
                turma.horarioSigaa,
            ]);

            const turmaId = res.rows[0].id;
            turma.id = turmaId;

            // Atualiza vínculos com professores
            await client.query("DELETE FROM professor_turma WHERE id_turma = $1;", [turmaId]);

            const sqlVinculo = `
                INSERT INTO professor_turma (matricula_siape, id_turma, carga_horaria_professor)
                VALUES ($1, $2, $3)
                ON CONFLICT (matricula_siape, id_turma) DO UPDATE
                SET carga_horaria_professor = EXCLUDED.carga_horaria_professor;
            `;

            for (const prof of turma.professores) {
                const carga = turma.cargaHorariaPorDocente?.[prof.matriculaSiape] ?? turma.disciplina.cargaHoraria;
                await client.query(sqlVinculo, [prof.matriculaSiape, turmaId, carga]);
            }

            await client.query("COMMIT;");
            return turma;
        } catch (err) {
            await client.query("ROLLBACK;");
            throw err;
        } finally {
            client.release();
        }
    }

    async inserirMuitas(turmas: readonly Turma[]): Promise<void> {
        for (const turma of turmas) {
            await this.inserir(turma);
        }
    }

    async buscarPorId(id: number): Promise<Turma | null> {
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
        const res = await query<TurmaRow>(sql, [id]);
        if (res.rows.length === 0) return null;

        const turmas = await this.hidratarProfessores(res.rows);
        return turmas[0] || null;
    }

    async listarPorSemestre(semestre: string): Promise<Turma[]> {
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
        const res = await query<TurmaRow>(sql, [semestre]);
        return this.hidratarProfessores(res.rows);
    }

    async listarTodas(): Promise<Turma[]> {
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
        const res = await query<TurmaRow>(sql);
        return this.hidratarProfessores(res.rows);
    }

    private async hidratarProfessores(turmaRows: TurmaRow[]): Promise<Turma[]> {
        if (turmaRows.length === 0) return [];

        const turmaIds = turmaRows.map((r) => r.t_id);

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

        const resDocentes = await query<ProfessorTurmaRow>(sqlDocentes, [turmaIds]);

        // Agrupa por id_turma -> Map de professores e cargas
        const profsPorTurma = new Map<number, Map<string, Professor>>();
        const cargaPorTurma = new Map<number, Record<string, number>>();

        for (const row of resDocentes.rows) {
            let mapaProfs = profsPorTurma.get(row.id_turma);
            if (!mapaProfs) {
                mapaProfs = new Map();
                profsPorTurma.set(row.id_turma, mapaProfs);
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
                if (!prof.indisponibilidades.some((i) => i.diaSemana === ind.diaSemana && i.turno === ind.turno && i.indiceHorario === ind.indiceHorario)) {
                    prof.indisponibilidades.push(ind);
                }
            }

            let cargas = cargaPorTurma.get(row.id_turma);
            if (!cargas) {
                cargas = {};
                cargaPorTurma.set(row.id_turma, cargas);
            }
            cargas[row.matricula_siape] = row.carga_horaria_professor;
        }

        return turmaRows.map((r) => {
            const disc: Disciplina = {
                codigo: r.d_codigo,
                nome: r.d_nome,
                cargaHoraria: Number(r.d_ch),
                exigeLaboratorio: Boolean(r.d_lab),
            };

            const profsMap = profsPorTurma.get(r.t_id);
            const professores = profsMap ? Array.from(profsMap.values()) : [];
            const cargaHorariaPorDocente = cargaPorTurma.get(r.t_id) || {};

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
                professores,
                cargaHorariaPorDocente,
            };
        });
    }
}
