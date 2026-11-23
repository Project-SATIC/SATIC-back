import { comTransacao, executarQuery, type QueryExecutor } from "../connection.ts";
import { ErroConflito, ErroValidacao } from "../../shared/erros.ts";
import type { Alocacao, Disciplina, Sala, StatusAlocacao, Turma } from "../../shared/tipos.ts";
import { hidratarProfessoresEmTurmas } from "./hidratar-professores.ts";

interface AlocacaoRow {
    a_id: number;
    a_horario: string;
    a_status: string;
    a_data: Date | string;
    a_atualizado?: Date | string | null;
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

function normalizarSemestreObrigatorio(semestre: string): string {
    if (typeof semestre !== "string" || semestre.trim() === "") {
        throw new ErroValidacao("Parâmetro 'semestre' deve ser uma string não vazia");
    }
    return semestre.trim();
}

export class AlocacaoRepository {
    async inserir(alocacao: Alocacao, executor?: QueryExecutor): Promise<Alocacao> {
        if (!alocacao.turma.id) throw new ErroValidacao("Turma deve possuir id para ser alocada");
        if (!alocacao.sala.id) throw new ErroValidacao("Sala deve possuir id para ser alocada");

        const sql = `
            INSERT INTO alocacao (id_turma, id_sala, horario_codigo, status)
            VALUES ($1, $2, $3, $4)
            RETURNING id, data_geracao, atualizado_em;
        `;
        const res = await executarQuery<{
            id: number;
            data_geracao: Date | string;
            atualizado_em?: Date | string | null;
        }>(
            sql,
            [alocacao.turma.id, alocacao.sala.id, alocacao.horarioCodigo, alocacao.status || "RASCUNHO"],
            executor
        );

        alocacao.id = Number(res.rows[0].id);
        alocacao.dataGeracao = normalizarDataIso(res.rows[0].data_geracao);
        alocacao.atualizadoEm = res.rows[0].atualizado_em
            ? normalizarDataIso(res.rows[0].atualizado_em)
            : alocacao.dataGeracao;
        return alocacao;
    }

    async inserirMuitas(alocacoes: readonly Alocacao[], executor?: QueryExecutor): Promise<void> {
        for (const aloc of alocacoes) {
            if (!aloc.turma.id) throw new ErroValidacao("Todas as turmas devem possuir id para serem alocadas");
            if (!aloc.sala.id) throw new ErroValidacao("Todas as salas devem possuir id para serem alocadas");
        }

        const executar = async (
            tx: QueryExecutor
        ): Promise<{ aloc: Alocacao; id: number; dataGeracao: string; atualizadoEm: string }[]> => {
            const sql = `
                INSERT INTO alocacao (id_turma, id_sala, horario_codigo, status)
                VALUES ($1, $2, $3, $4)
                RETURNING id, data_geracao, atualizado_em;
            `;
            const gravadas: { aloc: Alocacao; id: number; dataGeracao: string; atualizadoEm: string }[] = [];
            for (const aloc of alocacoes) {
                const res = await executarQuery<{
                    id: number;
                    data_geracao: Date | string;
                    atualizado_em?: Date | string | null;
                }>(
                    sql,
                    [aloc.turma.id, aloc.sala.id, aloc.horarioCodigo, aloc.status || "RASCUNHO"],
                    tx
                );
                const dataGeracao = normalizarDataIso(res.rows[0].data_geracao);
                const atualizadoEm = res.rows[0].atualizado_em
                    ? normalizarDataIso(res.rows[0].atualizado_em)
                    : dataGeracao;
                gravadas.push({ aloc, id: Number(res.rows[0].id), dataGeracao, atualizadoEm });
            }
            return gravadas;
        };

        const gravadas = executor
            ? await executar(executor)
            : await comTransacao((client) => executar(client));

        for (const item of gravadas) {
            item.aloc.id = item.id;
            item.aloc.dataGeracao = item.dataGeracao;
            item.aloc.atualizadoEm = item.atualizadoEm;
        }
    }

    async upsertExternaFixa(alocacao: Alocacao, executor?: QueryExecutor): Promise<Alocacao> {
        if (!alocacao.turma.id) throw new ErroValidacao("Turma deve possuir id para reserva externa fixa");
        if (!alocacao.sala.id) throw new ErroValidacao("Sala deve possuir id para reserva externa fixa");

        const sql = `
            INSERT INTO alocacao (id_turma, id_sala, horario_codigo, status)
            VALUES ($1, $2, $3, 'EXTERNA_FIXA')
            ON CONFLICT (id_turma) DO UPDATE
            SET id_sala = EXCLUDED.id_sala,
                horario_codigo = EXCLUDED.horario_codigo,
                status = 'EXTERNA_FIXA',
                atualizado_em = CURRENT_TIMESTAMP
            RETURNING id, data_geracao, atualizado_em;
        `;
        const res = await executarQuery<{
            id: number;
            data_geracao: Date | string;
            atualizado_em?: Date | string | null;
        }>(sql, [alocacao.turma.id, alocacao.sala.id, alocacao.horarioCodigo], executor);

        const dataGeracao = normalizarDataIso(res.rows[0].data_geracao);
        const atualizadoEm = res.rows[0].atualizado_em
            ? normalizarDataIso(res.rows[0].atualizado_em)
            : dataGeracao;

        return {
            ...alocacao,
            id: Number(res.rows[0].id),
            status: "EXTERNA_FIXA",
            dataGeracao,
            atualizadoEm,
        };
    }

    async listarTodas(executor?: QueryExecutor): Promise<Alocacao[]> {
        const sql = `
            SELECT a.id AS a_id, a.horario_codigo AS a_horario, a.status AS a_status,
                   a.data_geracao AS a_data, a.atualizado_em AS a_atualizado,
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
        const semestreLimpo = normalizarSemestreObrigatorio(semestre);
        const sql = `
            SELECT a.id AS a_id, a.horario_codigo AS a_horario, a.status AS a_status,
                   a.data_geracao AS a_data, a.atualizado_em AS a_atualizado,
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
        const res = await executarQuery<AlocacaoRow>(sql, [semestreLimpo], executor);
        return this.mapearAlocacoes(res.rows, executor);
    }

    async buscarPorId(id: number, executor?: QueryExecutor): Promise<Alocacao | null> {
        const sql = `
            SELECT a.id AS a_id, a.horario_codigo AS a_horario, a.status AS a_status,
                   a.data_geracao AS a_data, a.atualizado_em AS a_atualizado,
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
            WHERE a.id = $1;
        `;
        const res = await executarQuery<AlocacaoRow>(sql, [id], executor);
        if (res.rows.length === 0) return null;
        const alocacoes = await this.mapearAlocacoes(res.rows, executor);
        return alocacoes[0] || null;
    }

    async buscarPorTurmaId(turmaId: number, executor?: QueryExecutor): Promise<Alocacao | null> {
        const sql = `
            SELECT a.id AS a_id, a.horario_codigo AS a_horario, a.status AS a_status,
                   a.data_geracao AS a_data, a.atualizado_em AS a_atualizado,
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

    async atualizarComTimestamp(
        alocacaoId: number,
        novaSalaId: number,
        novoHorario: string,
        novoStatus?: StatusAlocacao,
        executor?: QueryExecutor
    ): Promise<{ atualizado: boolean; atualizadoEm: string | null }> {
        const sql = `
            UPDATE alocacao
            SET id_sala = $1,
                horario_codigo = $2,
                status = COALESCE($3, status),
                atualizado_em = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING atualizado_em;
        `;
        const res = await executarQuery<{ atualizado_em?: Date | string | null }>(
            sql,
            [novaSalaId, novoHorario, novoStatus || null, alocacaoId],
            executor
        );
        const atualizado = (res.rowCount ?? 0) > 0;
        const rawTs = res.rows[0]?.atualizado_em;
        return {
            atualizado,
            atualizadoEm: rawTs ? normalizarDataIso(rawTs) : null,
        };
    }

    async atualizarSalaEHorario(
        alocacaoId: number,
        novaSalaId: number,
        novoHorario: string,
        novoStatus?: StatusAlocacao,
        executor?: QueryExecutor
    ): Promise<boolean> {
        const res = await this.atualizarComTimestamp(
            alocacaoId,
            novaSalaId,
            novoHorario,
            novoStatus,
            executor
        );
        return res.atualizado;
    }

    async deletar(id: number, executor?: QueryExecutor): Promise<boolean> {
        const res = await executarQuery("DELETE FROM alocacao WHERE id = $1;", [id], executor);
        return (res.rowCount ?? 0) > 0;
    }

    async deletarProtegido(id: number, executor?: QueryExecutor): Promise<boolean> {
        const executar = async (tx: QueryExecutor): Promise<boolean> => {
            const info = await executarQuery<{ status: string; semestre: string }>(
                `
                    SELECT a.status, t.semestre
                    FROM alocacao a
                    JOIN turma t ON a.id_turma = t.id
                    WHERE a.id = $1;
                `,
                [id],
                tx
            );
            if (info.rows.length === 0) return false;

            const semestre = info.rows[0].semestre.trim();
            await executarQuery(
                "SELECT pg_advisory_xact_lock(hashtext($1));",
                [`satic:alocacao:${semestre}`],
                tx
            );

            const atual = await executarQuery<{ status: string }>(
                "SELECT status FROM alocacao WHERE id = $1;",
                [id],
                tx
            );
            if (atual.rows.length === 0) return false;
            if (atual.rows[0].status === "EXTERNA_FIXA") {
                throw new ErroConflito("Alocações com status EXTERNA_FIXA não podem ser removidas via API.");
            }

            const res = await executarQuery("DELETE FROM alocacao WHERE id = $1;", [id], tx);
            return (res.rowCount ?? 0) > 0;
        };

        if (executor) {
            return executar(executor);
        }
        return comTransacao((client) => executar(client));
    }

    async limparPorSemestre(
        semestre: string,
        incluirExternasFixas = false,
        executor?: QueryExecutor
    ): Promise<number> {
        const semestreLimpo = normalizarSemestreObrigatorio(semestre);
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
        const res = await executarQuery(sql, [semestreLimpo], executor);
        return res.rowCount ?? 0;
    }

    async substituirPorSemestre(
        semestre: string,
        alocacoes: readonly Alocacao[],
        executor?: QueryExecutor
    ): Promise<void> {
        const semestreLimpo = normalizarSemestreObrigatorio(semestre);
        const executar = async (tx: QueryExecutor): Promise<void> => {
            await executarQuery(
                "SELECT pg_advisory_xact_lock(hashtext($1));",
                [`satic:alocacao:${semestreLimpo}`],
                tx
            );
            await this.limparPorSemestre(semestreLimpo, false, tx);
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

            const dataGeracao = normalizarDataIso(r.a_data);
            return {
                id: Number(r.a_id),
                turma,
                sala,
                horarioCodigo: r.a_horario,
                status: r.a_status as StatusAlocacao,
                dataGeracao,
                atualizadoEm: r.a_atualizado ? normalizarDataIso(r.a_atualizado) : dataGeracao,
            };
        });

        await hidratarProfessoresEmTurmas(Array.from(cacheTurmas.values()), executor);
        return alocacoes;
    }
}
