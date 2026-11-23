import { comTransacao, executarQuery, type QueryExecutor } from "../connection.ts";
import { ErroValidacao } from "../../shared/erros.ts";
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

export interface FiltroTurmas {
    semestre?: string;
    requerAlocacaoIc?: boolean;
}

export interface DadosAtualizacaoTurma {
    disciplinaCodigo?: string;
    codigoTurma?: string;
    semestre?: string;
    cursosOfertados?: string;
    vagas?: number;
    matriculados?: number;
    requerAlocacaoIc?: boolean;
    horarioSigaa?: string;
    professores?: readonly { matriculaSiape: string; cargaHoraria?: number }[];
}

export class TurmaRepository {
    async criar(turma: Turma, executor?: QueryExecutor): Promise<Turma> {
        const executar = async (tx: QueryExecutor): Promise<number> => {
            const sqlTurma = `
                INSERT INTO turma (
                    id_disciplina, codigo_turma, semestre, cursos_ofertados,
                    vagas, matriculados, requer_alocacao_ic, horario_sigaa
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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

            return turmaId;
        };

        const turmaId = executor
            ? await executar(executor)
            : await comTransacao((client) => executar(client));
        turma.id = turmaId;
        return turma;
    }

    async inserir(turma: Turma, executor?: QueryExecutor): Promise<Turma> {
        const executar = async (tx: QueryExecutor): Promise<number> => {
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

            return turmaId;
        };

        const turmaId = executor
            ? await executar(executor)
            : await comTransacao((client) => executar(client));
        turma.id = turmaId;
        return turma;
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

    async listar(filtros: FiltroTurmas = {}, executor?: QueryExecutor): Promise<Turma[]> {
        const condicoes: string[] = [];
        const params: unknown[] = [];
        const semestreLimpo = typeof filtros.semestre === "string" ? filtros.semestre.trim() : "";

        if (semestreLimpo !== "") {
            params.push(semestreLimpo);
            condicoes.push(`t.semestre = $${params.length}`);
        }
        if (typeof filtros.requerAlocacaoIc === "boolean") {
            params.push(filtros.requerAlocacaoIc);
            condicoes.push(`t.requer_alocacao_ic = $${params.length}`);
        }

        const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";
        const orderBy =
            semestreLimpo !== ""
                ? "ORDER BY d.codigo ASC, t.codigo_turma ASC"
                : "ORDER BY t.semestre DESC, d.codigo ASC, t.codigo_turma ASC";

        const sql = `
            SELECT t.id AS t_id, t.codigo_turma AS t_codigo, t.semestre AS t_semestre,
                   t.cursos_ofertados AS t_cursos, t.vagas AS t_vagas,
                   t.matriculados AS t_matriculados, t.requer_alocacao_ic AS t_requer_ic,
                   t.horario_sigaa AS t_horario,
                   d.codigo AS d_codigo, d.nome AS d_nome, d.carga_horaria AS d_ch, d.exige_laboratorio AS d_lab
            FROM turma t
            JOIN disciplina d ON t.id_disciplina = d.codigo
            ${where}
            ${orderBy};
        `;
        const res = await executarQuery<TurmaRow>(sql, params.length > 0 ? params : undefined, executor);
        return this.mapearEHidratar(res.rows, executor);
    }

    async listarPorSemestre(semestre: string, executor?: QueryExecutor): Promise<Turma[]> {
        if (typeof semestre !== "string" || semestre.trim() === "") {
            throw new ErroValidacao("Parâmetro 'semestre' deve ser uma string não vazia");
        }
        return this.listar({ semestre: semestre.trim() }, executor);
    }

    async listarTodas(executor?: QueryExecutor): Promise<Turma[]> {
        return this.listar({}, executor);
    }

    async atualizar(
        id: number,
        dados: DadosAtualizacaoTurma,
        executor?: QueryExecutor
    ): Promise<Turma | null> {
        const executar = async (tx: QueryExecutor): Promise<Turma | null> => {
            const sqlUpdate = `
                UPDATE turma
                SET id_disciplina = COALESCE($1, id_disciplina),
                    codigo_turma = COALESCE($2, codigo_turma),
                    semestre = COALESCE($3, semestre),
                    cursos_ofertados = COALESCE($4, cursos_ofertados),
                    vagas = COALESCE($5, vagas),
                    matriculados = COALESCE($6, matriculados),
                    requer_alocacao_ic = COALESCE($7, requer_alocacao_ic),
                    horario_sigaa = COALESCE($8, horario_sigaa)
                WHERE id = $9
                RETURNING id, id_disciplina;
            `;
            const res = await executarQuery<{ id: number; id_disciplina: string }>(
                sqlUpdate,
                [
                    dados.disciplinaCodigo ?? null,
                    dados.codigoTurma ?? null,
                    dados.semestre ?? null,
                    dados.cursosOfertados ?? null,
                    dados.vagas ?? null,
                    dados.matriculados ?? null,
                    dados.requerAlocacaoIc ?? null,
                    dados.horarioSigaa ?? null,
                    id,
                ],
                tx
            );

            if (res.rows.length === 0) return null;

            if (dados.professores !== undefined) {
                const discRes = await executarQuery<{ carga_horaria: number }>(
                    "SELECT carga_horaria FROM disciplina WHERE codigo = $1;",
                    [res.rows[0].id_disciplina],
                    tx
                );
                const cargaPadrao = Number(discRes.rows[0]?.carga_horaria ?? 60);

                await executarQuery("DELETE FROM professor_turma WHERE id_turma = $1;", [id], tx);

                const sqlVinculo = `
                    INSERT INTO professor_turma (matricula_siape, id_turma, carga_horaria_professor)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (matricula_siape, id_turma) DO UPDATE
                    SET carga_horaria_professor = EXCLUDED.carga_horaria_professor;
                `;
                for (const prof of dados.professores) {
                    await executarQuery(
                        sqlVinculo,
                        [prof.matriculaSiape, id, prof.cargaHoraria ?? cargaPadrao],
                        tx
                    );
                }
            }

            return this.buscarPorId(id, tx);
        };

        if (executor) {
            return executar(executor);
        }
        return comTransacao((client) => executar(client));
    }

    async deletar(id: number, executor?: QueryExecutor): Promise<boolean> {
        const res = await executarQuery("DELETE FROM turma WHERE id = $1;", [id], executor);
        return (res.rowCount ?? 0) > 0;
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
