import { executorPadrao, type Executor } from "../connection.ts";
import type { Alocacao, Sala, StatusAlocacao, Turma } from "../../shared/tipos.ts";
import { COLUNAS_TURMA, carregarDocentesDasTurmas, mapearTurma, type TurmaRow } from "./turma.repository.ts";

interface AlocacaoRow extends TurmaRow {
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
}

const SELECT_ALOCACOES = `
    SELECT a.id AS a_id, a.horario_codigo AS a_horario, a.status AS a_status, a.data_geracao AS a_data,
           s.id AS s_id, s.nome AS s_nome, s.capacidade AS s_cap,
           s.tipo_espaco AS s_tipo, s.bloco AS s_bloco, s.alocavel_ic AS s_alocavel,
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
    RETURNING id, data_geracao;
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
        const res = await db.query<{ id: number; data_geracao: Date }>(INSERT_ALOCACAO, [
            turmaId,
            salaId,
            alocacao.horarioCodigo,
            alocacao.status || "RASCUNHO",
        ]);
        alocacao.id = Number(res.rows[0].id);
        alocacao.dataGeracao = paraIso(res.rows[0].data_geracao);
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

    /** Alocação da turma (a migration 002 garante no máximo uma por turma). */
    async buscarPorTurmaId(turmaId: number, db: Executor = executorPadrao): Promise<Alocacao | null> {
        const res = await db.query<AlocacaoRow>(`${SELECT_ALOCACOES} WHERE a.id_turma = $1 ORDER BY a.id DESC LIMIT 1;`, [turmaId]);
        return (await this.#mapear(res.rows, db))[0] ?? null;
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

    async #mapear(rows: AlocacaoRow[], db: Executor): Promise<Alocacao[]> {
        // Hidrata docentes e indisponibilidades: o validador precisa deles para RN-01/RN-02
        const docentes = await carregarDocentesDasTurmas(rows.map((r) => r.t_id), db);
        const turmas = new Map<number, Turma>();

        return rows.map((r) => {
            const sala: Sala = {
                id: Number(r.s_id),
                nome: r.s_nome,
                capacidade: Number(r.s_cap),
                tipoEspaco: r.s_tipo,
                bloco: r.s_bloco,
                alocavelIc: Boolean(r.s_alocavel),
            };
            const idTurma = Number(r.t_id);
            let turma = turmas.get(idTurma);
            if (!turma) {
                turma = mapearTurma(r, docentes);
                turmas.set(idTurma, turma);
            }
            return {
                id: Number(r.a_id),
                turma,
                sala,
                horarioCodigo: r.a_horario,
                status: r.a_status as StatusAlocacao,
                dataGeracao: paraIso(r.a_data),
            };
        });
    }
}
