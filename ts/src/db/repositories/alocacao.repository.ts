import { bloquearSemestre, comTransacao, executorPadrao, type Executor } from "../connection.ts";
import { ErroConflito } from "../../erros.ts";
import type { Alocacao, Sala, StatusAlocacao, StatusSala, Turma } from "../../shared/tipos.ts";
import { COLUNAS_TURMA, carregarDocentesDasTurmas, mapearTurma, type TurmaRow } from "./turma.repository.ts";

export interface PublicacaoSemestre {
    semestre: string;
    publicada: boolean;
    publicadoEm: string | null;
}

interface AlocacaoRow extends TurmaRow {
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
    s_status?: string | null;
    s_pcs?: number | null;
    s_equip?: string[] | null;
    s_obs?: string | null;
}

const SELECT_ALOCACOES = `
    SELECT a.id AS a_id, a.horario_codigo AS a_horario, a.status AS a_status,
           a.data_geracao AS a_data, a.atualizado_em AS a_atualizado,
           s.id AS s_id, s.nome AS s_nome, s.capacidade AS s_cap,
           s.tipo_espaco AS s_tipo, s.bloco AS s_bloco, s.alocavel_ic AS s_alocavel,
           s.status AS s_status, s.pcs AS s_pcs, s.equipamentos AS s_equip, s.observacao AS s_obs,
           ${COLUNAS_TURMA}
    FROM alocacao a
    JOIN sala s ON a.id_sala = s.id
    JOIN turma t ON a.id_turma = t.id
    JOIN disciplina d ON t.id_disciplina = d.codigo
`;

const ORDEM_ALOCACOES = `ORDER BY a.horario_codigo COLLATE "C" ASC, s.nome COLLATE "C" ASC, a.id ASC`;

const INSERT_ALOCACAO = `
    INSERT INTO alocacao (id_turma, id_sala, horario_codigo, status)
    VALUES ($1, $2, $3, $4)
    RETURNING id, data_geracao, atualizado_em;
`;

function paraIso(data: Date | string): string {
    return data instanceof Date ? data.toISOString() : String(data);
}

function idsObrigatorios(alocacao: Alocacao): { turmaId: number; salaId: number } {
    if (!alocacao.turma?.id) throw new Error(`Turma ${alocacao.turma?.disciplina?.codigo ?? "?"}-${alocacao.turma?.codigoTurma ?? "?"} sem id não pode ser alocada`);
    if (!alocacao.sala?.id) throw new Error(`Sala '${alocacao.sala?.nome ?? "?"}' sem id não pode receber alocação`);
    return { turmaId: alocacao.turma.id, salaId: alocacao.sala.id };
}

export class AlocacaoRepository {
    async inserir(alocacao: Alocacao, db: Executor = executorPadrao): Promise<Alocacao> {
        const { turmaId, salaId } = idsObrigatorios(alocacao);
        const res = await db.query<{ id: number; data_geracao: Date; atualizado_em?: Date }>(INSERT_ALOCACAO, [
            turmaId,
            salaId,
            alocacao.horarioCodigo,
            alocacao.status || "RASCUNHO",
        ]);
        alocacao.id = Number(res.rows[0].id);
        alocacao.dataGeracao = paraIso(res.rows[0].data_geracao);
        alocacao.atualizadoEm = res.rows[0].atualizado_em != null
            ? paraIso(res.rows[0].atualizado_em)
            : alocacao.dataGeracao;
        return alocacao;
    }

    /** Insere várias alocações no executor informado (use dentro de uma transação). Falha se faltar id. */
    async inserirMuitas(alocacoes: readonly Alocacao[], db: Executor = executorPadrao): Promise<void> {
        for (const aloc of alocacoes) {
            await this.inserir(aloc, db);
        }
    }

    async listarTodas(db: Executor = executorPadrao): Promise<Alocacao[]> {
        const res = await db.query<AlocacaoRow>(`${SELECT_ALOCACOES} ${ORDEM_ALOCACOES};`);
        return this.#mapear(res.rows, db);
    }

    async listarPorSemestre(semestre: string, db: Executor = executorPadrao): Promise<Alocacao[]> {
        const res = await db.query<AlocacaoRow>(`${SELECT_ALOCACOES} WHERE t.semestre = $1 ${ORDEM_ALOCACOES};`, [semestre]);
        return this.#mapear(res.rows, db);
    }

    async buscarPorId(id: number, db: Executor = executorPadrao): Promise<Alocacao | null> {
        const res = await db.query<AlocacaoRow>(`${SELECT_ALOCACOES} WHERE a.id = $1;`, [id]);
        return (await this.#mapear(res.rows, db))[0] ?? null;
    }

    /** Alocação da turma (a migration 002 garante no máximo uma por turma). */
    async buscarPorTurmaId(turmaId: number, db: Executor = executorPadrao): Promise<Alocacao | null> {
        const res = await db.query<AlocacaoRow>(`${SELECT_ALOCACOES} WHERE a.id_turma = $1 ORDER BY a.id DESC LIMIT 1;`, [turmaId]);
        return (await this.#mapear(res.rows, db))[0] ?? null;
    }

    /**
     * Remove uma alocação por id, bloqueando com HTTP 409 a exclusão de reservas EXTERNA_FIXA.
     * Também desmarca `publicada` do semestre correspondente na mesma transação.
     * Devolve false se o id não existir.
     */
    async deletarProtegido(id: number, db?: Executor): Promise<boolean> {
        const executar = async (exec: Executor): Promise<boolean> => {
            const res = await exec.query<{ status: string; semestre?: string | null }>(
                `SELECT a.status, t.semestre
                 FROM alocacao a
                 LEFT JOIN turma t ON t.id = a.id_turma
                 WHERE a.id = $1
                 FOR UPDATE OF a;`,
                [id],
            );
            if (res.rows.length === 0) return false;
            if (res.rows[0].status === "EXTERNA_FIXA") {
                throw new ErroConflito("Reserva EXTERNA_FIXA de outro instituto não pode ser removida pela secretaria");
            }
            const del = await exec.query("DELETE FROM alocacao WHERE id = $1;", [id]);
            const removeu = (del.rowCount ?? 0) > 0;
            if (removeu && res.rows[0].semestre) {
                await this.definirPublicacaoSemestre(res.rows[0].semestre, false, exec).catch(() => undefined);
            }
            return removeu;
        };
        return db ? executar(db) : comTransacao(executar);
    }

    async atualizarSalaEHorario(
        alocacaoId: number,
        novaSalaId: number,
        novoHorario: string,
        novoStatus?: StatusAlocacao,
        db: Executor = executorPadrao,
    ): Promise<boolean> {
        const res = await db.query(`
            UPDATE alocacao
            SET id_sala = $1,
                horario_codigo = $2,
                status = COALESCE($3, status),
                data_geracao = CURRENT_TIMESTAMP
            WHERE id = $4;
        `, [novaSalaId, novoHorario, novoStatus || null, alocacaoId]);
        return (res.rowCount ?? 0) > 0;
    }

    /**
     * Remove as alocações do semestre com os status informados.
     * Por padrão apaga só RASCUNHO: reservas EXTERNA_FIXA e remanejamentos DEFINITIVA são preservados.
     */
    async limparPorSemestre(
        semestre: string,
        status: readonly StatusAlocacao[] = ["RASCUNHO"],
        db: Executor = executorPadrao,
    ): Promise<number> {
        if (status.length === 0) return 0;
        const res = await db.query(`
            DELETE FROM alocacao
            WHERE status = ANY($2::text[])
              AND id_turma IN (SELECT id FROM turma WHERE semestre = $1);
        `, [semestre, [...status]]);
        return res.rowCount ?? 0;
    }

    /** Tira a turma da grade (ela volta a ser pendente). Devolve quantas alocações foram removidas. */
    async removerPorTurmaId(turmaId: number, db: Executor = executorPadrao): Promise<number> {
        const res = await db.query("DELETE FROM alocacao WHERE id_turma = $1;", [turmaId]);
        return res.rowCount ?? 0;
    }

    /**
     * Grava (ou atualiza) a reserva EXTERNA_FIXA de uma turma de outro instituto numa sala do pool do IC.
     * Idempotente: rodar o seed de novo não duplica a reserva.
     */
    async registrarReservaExterna(turmaId: number, salaId: number, horario: string, db: Executor = executorPadrao): Promise<void> {
        await db.query(`
            INSERT INTO alocacao (id_turma, id_sala, horario_codigo, status)
            VALUES ($1, $2, $3, 'EXTERNA_FIXA')
            ON CONFLICT (id_turma) DO UPDATE
            SET id_sala = EXCLUDED.id_sala,
                horario_codigo = EXCLUDED.horario_codigo,
                status = 'EXTERNA_FIXA';
        `, [turmaId, salaId, horario]);
    }

    /** Consulta se a grade do semestre está publicada. */
    async obterPublicacaoSemestre(semestre: string, db: Executor = executorPadrao): Promise<PublicacaoSemestre> {
        const res = await db.query<{ semestre: string; publicada: boolean; publicado_em: Date | string | null }>(
            "SELECT semestre, publicada, publicado_em FROM semestre_publicacao WHERE semestre = $1;",
            [semestre],
        );
        if (res.rows.length === 0) {
            return { semestre, publicada: false, publicadoEm: null };
        }
        return {
            semestre: res.rows[0].semestre,
            publicada: Boolean(res.rows[0].publicada),
            publicadoEm: res.rows[0].publicado_em != null ? paraIso(res.rows[0].publicado_em) : null,
        };
    }

    /** Atualiza o flag de publicação do semestre (ex.: despublicar ao alterar a grade). */
    async definirPublicacaoSemestre(
        semestre: string,
        publicada: boolean,
        db: Executor = executorPadrao,
    ): Promise<PublicacaoSemestre> {
        const res = await db.query<{ semestre: string; publicada: boolean; publicado_em: Date | string | null }>(`
            INSERT INTO semestre_publicacao (semestre, publicada, publicado_em)
            VALUES ($1, $2, CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE NULL END)
            ON CONFLICT (semestre) DO UPDATE
            SET publicada = EXCLUDED.publicada,
                publicado_em = CASE WHEN EXCLUDED.publicada THEN CURRENT_TIMESTAMP ELSE semestre_publicacao.publicado_em END
            RETURNING semestre, publicada, publicado_em;
        `, [semestre, publicada]);
        return {
            semestre: res.rows[0].semestre,
            publicada: Boolean(res.rows[0].publicada),
            publicadoEm: res.rows[0].publicado_em != null ? paraIso(res.rows[0].publicado_em) : null,
        };
    }

    /**
     * Congela todos os RASCUNHO do semestre como DEFINITIVA e grava `publicada = TRUE` em `semestre_publicacao`.
     */
    async publicarSemestre(
        semestre: string,
        db?: Executor,
    ): Promise<PublicacaoSemestre & { congeladas: number }> {
        const executar = async (exec: Executor): Promise<PublicacaoSemestre & { congeladas: number }> => {
            await bloquearSemestre(exec, semestre);
            const congeladasRes = await exec.query(`
                UPDATE alocacao
                SET status = 'DEFINITIVA'
                WHERE status = 'RASCUNHO'
                  AND id_turma IN (SELECT id FROM turma WHERE semestre = $1);
            `, [semestre]);
            const pub = await this.definirPublicacaoSemestre(semestre, true, exec);
            return { ...pub, congeladas: congeladasRes.rowCount ?? 0 };
        };
        return db ? executar(db) : comTransacao(executar);
    }

    async #mapear(rows: AlocacaoRow[], db: Executor): Promise<Alocacao[]> {
        // Hidrata docentes e indisponibilidades: o validador precisa deles para RN-01/RN-02
        const docentes = await carregarDocentesDasTurmas(rows.map((r) => r.t_id), db);
        const turmas = new Map<number, Turma>();

        return rows.map((r) => {
            const cap = Number(r.s_cap);
            const tipo = r.s_tipo;
            const alocavel = Boolean(r.s_alocavel);
            const statusSala: StatusSala = r.s_status === "Manutenção" ? "Manutenção" : "Disponível";
            const sala: Sala = {
                id: Number(r.s_id),
                nome: r.s_nome,
                capacidade: cap,
                tipoEspaco: tipo,
                bloco: r.s_bloco,
                alocavelIc: alocavel,
                status: statusSala,
                pcs: r.s_pcs != null ? Number(r.s_pcs) : (tipo.toLowerCase().startsWith("laborat") ? cap : 0),
                equipamentos: Array.isArray(r.s_equip) ? r.s_equip.map(String) : [],
                observacao: r.s_obs != null ? r.s_obs : (alocavel ? "Pool de salas do IC." : "Fora do pool do IC (CTEC/IF)."),
            };
            const idTurma = Number(r.t_id);
            let turma = turmas.get(idTurma);
            if (!turma) {
                turma = mapearTurma(r, docentes);
                turmas.set(idTurma, turma);
            }
            const dataIso = paraIso(r.a_data);
            return {
                id: Number(r.a_id),
                turma,
                sala,
                horarioCodigo: r.a_horario,
                status: r.a_status as StatusAlocacao,
                dataGeracao: dataIso,
                atualizadoEm: r.a_atualizado != null ? paraIso(r.a_atualizado) : dataIso,
            };
        });
    }
}
