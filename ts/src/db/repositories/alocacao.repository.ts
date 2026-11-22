import { comTransacao, executarQuery, type QueryExecutor } from "../connection.ts";
import type { Alocacao, Disciplina, Sala, StatusAlocacao, Turma } from "../../shared/tipos.ts";
import { hidratarProfessoresEmTurmas } from "./hidratar-professores.ts";

interface AlocacaoRow {
    a_id: number;
    a_horario: string;
    a_status: string;
    a_data: Date | string;
    s_id: number;
    s_nome: string;
    s_cap: number;
    s_tipo: string;
    s_bloco: string;
    s_alocavel: boolean;
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

function normalizarDataIso(valor: Date | string): string {
    return valor instanceof Date ? valor.toISOString() : String(valor);
}

export class AlocacaoRepository {
    async inserir(alocacao: Alocacao, executor?: QueryExecutor): Promise<Alocacao> {
        if (!alocacao.turma.id) throw new Error("Turma deve possuir id para ser alocada");
        if (!alocacao.sala.id) throw new Error("Sala deve possuir id para ser alocada");

        const sql = `
            INSERT INTO alocacao (id_turma, id_sala, horario_codigo, status)
            VALUES ($1, $2, $3, $4)
            RETURNING id, data_geracao;
        `;
        const res = await executarQuery<{ id: number; data_geracao: Date | string }>(
            sql,
            [alocacao.turma.id, alocacao.sala.id, alocacao.horarioCodigo, alocacao.status || "RASCUNHO"],
            executor
        );

        alocacao.id = Number(res.rows[0].id);
        alocacao.dataGeracao = normalizarDataIso(res.rows[0].data_geracao);
        return alocacao;
    }

    async inserirMuitas(alocacoes: readonly Alocacao[], executor?: QueryExecutor): Promise<void> {
        const executar = async (tx: QueryExecutor): Promise<void> => {
            const sql = `
                INSERT INTO alocacao (id_turma, id_sala, horario_codigo, status)
                VALUES ($1, $2, $3, $4)
                RETURNING id, data_geracao;
            `;
            for (const aloc of alocacoes) {
                if (!aloc.turma.id || !aloc.sala.id) continue;
                const res = await executarQuery<{ id: number; data_geracao: Date | string }>(
                    sql,
                    [aloc.turma.id, aloc.sala.id, aloc.horarioCodigo, aloc.status || "RASCUNHO"],
                    tx
                );
                aloc.id = Number(res.rows[0].id);
                aloc.dataGeracao = normalizarDataIso(res.rows[0].data_geracao);
            }
        };

        if (executor) {
            await executar(executor);
            return;
        }
        await comTransacao((client) => executar(client));
    }

    async upsertExternaFixa(alocacao: Alocacao, executor?: QueryExecutor): Promise<Alocacao> {
        if (!alocacao.turma.id) throw new Error("Turma deve possuir id para reserva externa fixa");
        if (!alocacao.sala.id) throw new Error("Sala deve possuir id para reserva externa fixa");

        const executar = async (tx: QueryExecutor): Promise<Alocacao> => {
            const existente = await executarQuery<{ id: number; data_geracao: Date | string }>(
                `
                    SELECT id, data_geracao
                    FROM alocacao
                    WHERE id_turma = $1 AND status = 'EXTERNA_FIXA'
                    ORDER BY id ASC
                    LIMIT 1;
                `,
                [alocacao.turma.id],
                tx
            );

            if (existente.rows.length > 0) {
                const idExistente = Number(existente.rows[0].id);
                await executarQuery(
                    `
                        UPDATE alocacao
                        SET id_sala = $1,
                            horario_codigo = $2,
                            status = 'EXTERNA_FIXA'
                        WHERE id = $3;
                    `,
                    [alocacao.sala.id, alocacao.horarioCodigo, idExistente],
                    tx
                );
                alocacao.id = idExistente;
                alocacao.status = "EXTERNA_FIXA";
                alocacao.dataGeracao = normalizarDataIso(existente.rows[0].data_geracao);
                return alocacao;
            }

            return this.inserir({ ...alocacao, status: "EXTERNA_FIXA" }, tx);
        };

        if (executor) {
            return executar(executor);
        }
        return comTransacao((client) => executar(client));
    }

    async listarTodas(executor?: QueryExecutor): Promise<Alocacao[]> {
        const sql = `
            SELECT a.id AS a_id, a.horario_codigo AS a_horario, a.status AS a_status, a.data_geracao AS a_data,
                   s.id AS s_id, s.nome AS s_nome, s.capacidade AS s_cap,
                   s.tipo_espaco AS s_tipo, s.bloco AS s_bloco, s.alocavel_ic AS s_alocavel,
                   t.id AS t_id, t.codigo_turma AS t_codigo, t.semestre AS t_semestre,
                   t.cursos_ofertados AS t_cursos, t.vagas AS t_vagas,
                   t.matriculados AS t_matriculados, t.requer_alocacao_ic AS t_requer_ic,
                   t.horario_sigaa AS t_horario,
                   d.codigo AS d_codigo, d.nome AS d_nome, d.carga_horaria AS d_ch, d.exige_laboratorio AS d_lab
            FROM alocacao a
            JOIN sala s ON a.id_sala = s.id
            JOIN turma t ON a.id_turma = t.id
            JOIN disciplina d ON t.id_disciplina = d.codigo
            ORDER BY a.horario_codigo ASC, s.nome ASC;
        `;
        const res = await executarQuery<AlocacaoRow>(sql, undefined, executor);
        return this.mapearAlocacoes(res.rows, executor);
    }

    async listarPorSemestre(semestre: string, executor?: QueryExecutor): Promise<Alocacao[]> {
        const sql = `
            SELECT a.id AS a_id, a.horario_codigo AS a_horario, a.status AS a_status, a.data_geracao AS a_data,
                   s.id AS s_id, s.nome AS s_nome, s.capacidade AS s_cap,
                   s.tipo_espaco AS s_tipo, s.bloco AS s_bloco, s.alocavel_ic AS s_alocavel,
                   t.id AS t_id, t.codigo_turma AS t_codigo, t.semestre AS t_semestre,
                   t.cursos_ofertados AS t_cursos, t.vagas AS t_vagas,
                   t.matriculados AS t_matriculados, t.requer_alocacao_ic AS t_requer_ic,
                   t.horario_sigaa AS t_horario,
                   d.codigo AS d_codigo, d.nome AS d_nome, d.carga_horaria AS d_ch, d.exige_laboratorio AS d_lab
            FROM alocacao a
            JOIN sala s ON a.id_sala = s.id
            JOIN turma t ON a.id_turma = t.id
            JOIN disciplina d ON t.id_disciplina = d.codigo
            WHERE t.semestre = $1
            ORDER BY a.horario_codigo ASC, s.nome ASC;
        `;
        const res = await executarQuery<AlocacaoRow>(sql, [semestre], executor);
        return this.mapearAlocacoes(res.rows, executor);
    }

    async buscarPorTurmaId(turmaId: number, executor?: QueryExecutor): Promise<Alocacao | null> {
        const sql = `
            SELECT a.id AS a_id, a.horario_codigo AS a_horario, a.status AS a_status, a.data_geracao AS a_data,
                   s.id AS s_id, s.nome AS s_nome, s.capacidade AS s_cap,
                   s.tipo_espaco AS s_tipo, s.bloco AS s_bloco, s.alocavel_ic AS s_alocavel,
                   t.id AS t_id, t.codigo_turma AS t_codigo, t.semestre AS t_semestre,
                   t.cursos_ofertados AS t_cursos, t.vagas AS t_vagas,
                   t.matriculados AS t_matriculados, t.requer_alocacao_ic AS t_requer_ic,
                   t.horario_sigaa AS t_horario,
                   d.codigo AS d_codigo, d.nome AS d_nome, d.carga_horaria AS d_ch, d.exige_laboratorio AS d_lab
            FROM alocacao a
            JOIN sala s ON a.id_sala = s.id
            JOIN turma t ON a.id_turma = t.id
            JOIN disciplina d ON t.id_disciplina = d.codigo
            WHERE a.id_turma = $1
            ORDER BY a.id DESC
            LIMIT 1;
        `;
        const res = await executarQuery<AlocacaoRow>(sql, [turmaId], executor);
        if (res.rows.length === 0) return null;
        const alocacoes = await this.mapearAlocacoes(res.rows, executor);
        return alocacoes[0] || null;
    }

    async atualizarSalaEHorario(
        alocacaoId: number,
        novaSalaId: number,
        novoHorario: string,
        novoStatus?: StatusAlocacao,
        executor?: QueryExecutor
    ): Promise<boolean> {
        const sql = `
            UPDATE alocacao
            SET id_sala = $1,
                horario_codigo = $2,
                status = COALESCE($3, status)
            WHERE id = $4;
        `;
        const res = await executarQuery(sql, [novaSalaId, novoHorario, novoStatus || null, alocacaoId], executor);
        return (res.rowCount ?? 0) > 0;
    }

    async limparPorSemestre(
        semestre: string,
        incluirExternasFixas = false,
        executor?: QueryExecutor
    ): Promise<number> {
        const sql = incluirExternasFixas
            ? `
                DELETE FROM alocacao
                WHERE id_turma IN (SELECT id FROM turma WHERE semestre = $1);
            `
            : `
                DELETE FROM alocacao
                WHERE status <> 'EXTERNA_FIXA'
                  AND id_turma IN (SELECT id FROM turma WHERE semestre = $1);
            `;
        const res = await executarQuery(sql, [semestre], executor);
        return res.rowCount ?? 0;
    }

    async substituirPorSemestre(
        semestre: string,
        alocacoes: readonly Alocacao[],
        executor?: QueryExecutor
    ): Promise<void> {
        const executar = async (tx: QueryExecutor): Promise<void> => {
            await executarQuery(
                "SELECT pg_advisory_xact_lock(hashtext($1));",
                [`satic:alocacao:${semestre}`],
                tx
            );
            await this.limparPorSemestre(semestre, false, tx);
            const novas = alocacoes.filter((a) => a.status !== "EXTERNA_FIXA");
            if (novas.length > 0) {
                await this.inserirMuitas(novas, tx);
            }
        };

        if (executor) {
            await executar(executor);
            return;
        }
        await comTransacao((client) => executar(client));
    }

    private async mapearAlocacoes(rows: AlocacaoRow[], executor?: QueryExecutor): Promise<Alocacao[]> {
        if (rows.length === 0) return [];

        const cacheTurmas = new Map<number, Turma>();

        const alocacoes = rows.map((r) => {
            const sala: Sala = {
                id: Number(r.s_id),
                nome: r.s_nome,
                capacidade: Number(r.s_cap),
                tipoEspaco: r.s_tipo,
                bloco: r.s_bloco,
                alocavelIc: Boolean(r.s_alocavel),
            };

            const turmaId = Number(r.t_id);
            let turma = cacheTurmas.get(turmaId);
            if (!turma) {
                const disc: Disciplina = {
                    codigo: r.d_codigo,
                    nome: r.d_nome,
                    cargaHoraria: Number(r.d_ch),
                    exigeLaboratorio: Boolean(r.d_lab),
                };

                turma = {
                    id: turmaId,
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
                cacheTurmas.set(turmaId, turma);
            }

            return {
                id: Number(r.a_id),
                turma,
                sala,
                horarioCodigo: r.a_horario,
                status: r.a_status as StatusAlocacao,
                dataGeracao: normalizarDataIso(r.a_data),
            };
        });

        await hidratarProfessoresEmTurmas(Array.from(cacheTurmas.values()), executor);
        return alocacoes;
    }
}
