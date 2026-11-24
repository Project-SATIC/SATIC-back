import { executorPadrao, query, type Executor } from "../connection.ts";
import type { Sala, StatusSala } from "../../shared/tipos.ts";

interface SalaRow {
    id: number;
    nome: string;
    capacidade: number;
    tipo_espaco: string;
    bloco: string;
    alocavel_ic: boolean;
    status?: string | null;
    pcs?: number | null;
    equipamentos?: string[] | null;
    observacao?: string | null;
}

export type CriarSalaInput = Omit<Sala, "id">;
export type AtualizarSalaInput = Partial<Omit<Sala, "id">>;

const COLUNAS_SALA = "id, nome, capacidade, tipo_espaco, bloco, alocavel_ic, status, pcs, equipamentos, observacao";

function pcsPadrao(tipoEspaco: string, capacidade: number): number {
    return tipoEspaco.toLowerCase().startsWith("laborat") ? capacidade : 0;
}

function observacaoPadrao(alocavelIc: boolean): string {
    return alocavelIc ? "Pool de salas do IC." : "Fora do pool do IC (CTEC/IF).";
}

function mapearLinha(row: SalaRow): Sala {
    const capacidade = Number(row.capacidade);
    const tipoEspaco = row.tipo_espaco;
    const alocavelIc = Boolean(row.alocavel_ic);
    const status: StatusSala = row.status === "Manutenção" ? "Manutenção" : "Disponível";
    return {
        id: Number(row.id),
        nome: row.nome,
        capacidade,
        tipoEspaco,
        bloco: row.bloco,
        alocavelIc,
        status,
        pcs: row.pcs != null ? Number(row.pcs) : pcsPadrao(tipoEspaco, capacidade),
        equipamentos: Array.isArray(row.equipamentos) ? row.equipamentos.map(String) : [],
        observacao: row.observacao !== undefined && row.observacao !== null
            ? row.observacao
            : observacaoPadrao(alocavelIc),
    };
}

export class SalaRepository {
    async inserir(sala: Sala): Promise<Sala> {
        const status: StatusSala = sala.status === "Manutenção" ? "Manutenção" : "Disponível";
        const pcs = sala.pcs ?? pcsPadrao(sala.tipoEspaco, sala.capacidade);
        const equipamentos = sala.equipamentos ?? [];
        const observacao = sala.observacao !== undefined ? sala.observacao : observacaoPadrao(sala.alocavelIc);

        const sql = `
            INSERT INTO sala (nome, capacidade, tipo_espaco, bloco, alocavel_ic, status, pcs, equipamentos, observacao)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (nome) DO UPDATE
            SET capacidade = EXCLUDED.capacidade,
                tipo_espaco = EXCLUDED.tipo_espaco,
                bloco = EXCLUDED.bloco,
                alocavel_ic = EXCLUDED.alocavel_ic
            RETURNING ${COLUNAS_SALA};
        `;
        const res = await query<SalaRow>(sql, [
            sala.nome,
            sala.capacidade,
            sala.tipoEspaco,
            sala.bloco,
            sala.alocavelIc,
            status,
            pcs,
            equipamentos,
            observacao,
        ]);
        return mapearLinha(res.rows[0]);
    }

    /** Insere uma nova sala sem sobrescrever (duplicata de nome dispara erro 23505 -> HTTP 409). */
    async criar(sala: CriarSalaInput, db: Executor = executorPadrao): Promise<Sala> {
        const status: StatusSala = sala.status === "Manutenção" ? "Manutenção" : "Disponível";
        const pcs = sala.pcs ?? pcsPadrao(sala.tipoEspaco, sala.capacidade);
        const equipamentos = sala.equipamentos ?? [];
        const observacao = sala.observacao !== undefined ? sala.observacao : observacaoPadrao(sala.alocavelIc);

        const res = await db.query<SalaRow>(`
            INSERT INTO sala (nome, capacidade, tipo_espaco, bloco, alocavel_ic, status, pcs, equipamentos, observacao)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING ${COLUNAS_SALA};
        `, [
            sala.nome,
            sala.capacidade,
            sala.tipoEspaco,
            sala.bloco,
            sala.alocavelIc,
            status,
            pcs,
            equipamentos,
            observacao,
        ]);
        return mapearLinha(res.rows[0]);
    }

    async atualizar(id: number, dados: AtualizarSalaInput, db: Executor = executorPadrao): Promise<Sala | null> {
        const atual = await this.buscarPorId(id, db);
        if (!atual) return null;

        const tipoEspaco = dados.tipoEspaco ?? atual.tipoEspaco;
        const capacidade = dados.capacidade ?? atual.capacidade;
        const alocavelIc = dados.alocavelIc ?? atual.alocavelIc;
        const status: StatusSala = (dados.status ?? atual.status) === "Manutenção" ? "Manutenção" : "Disponível";
        const pcs = dados.pcs !== undefined ? dados.pcs : (atual.pcs ?? pcsPadrao(tipoEspaco, capacidade));
        const equipamentos = dados.equipamentos !== undefined ? dados.equipamentos : (atual.equipamentos ?? []);
        const observacao = dados.observacao !== undefined ? dados.observacao : (atual.observacao ?? observacaoPadrao(alocavelIc));

        const res = await db.query<SalaRow>(`
            UPDATE sala
            SET nome = $1,
                capacidade = $2,
                tipo_espaco = $3,
                bloco = $4,
                alocavel_ic = $5,
                status = $6,
                pcs = $7,
                equipamentos = $8,
                observacao = $9
            WHERE id = $10
            RETURNING ${COLUNAS_SALA};
        `, [
            dados.nome ?? atual.nome,
            capacidade,
            tipoEspaco,
            dados.bloco ?? atual.bloco,
            alocavelIc,
            status,
            pcs,
            equipamentos,
            observacao,
            id,
        ]);
        return res.rows.length > 0 ? mapearLinha(res.rows[0]) : null;
    }

    async deletar(id: number, db: Executor = executorPadrao): Promise<boolean> {
        const res = await db.query("DELETE FROM sala WHERE id = $1;", [id]);
        return (res.rowCount ?? 0) > 0;
    }

    async inserirMuitas(salas: readonly Sala[]): Promise<void> {
        for (const sala of salas) {
            await this.inserir(sala);
        }
    }

    async buscarPorId(id: number, db: Executor = executorPadrao): Promise<Sala | null> {
        const res = await db.query<SalaRow>(
            `SELECT ${COLUNAS_SALA} FROM sala WHERE id = $1;`,
            [id]
        );
        if (res.rows.length === 0) return null;
        return mapearLinha(res.rows[0]);
    }

    async buscarPorNome(nome: string): Promise<Sala | null> {
        const res = await query<SalaRow>(
            `SELECT ${COLUNAS_SALA} FROM sala WHERE nome = $1;`,
            [nome]
        );
        if (res.rows.length === 0) return null;
        return mapearLinha(res.rows[0]);
    }

    async listarTodas(db: Executor = executorPadrao): Promise<Sala[]> {
        const res = await db.query<SalaRow>(
            `SELECT ${COLUNAS_SALA} FROM sala ORDER BY bloco COLLATE "C" ASC, nome COLLATE "C" ASC;`
        );
        return res.rows.map(mapearLinha);
    }

    /** Salas do pool do IC que estão com status 'Disponível' (salas em manutenção saem do pool). */
    async listarAlocaveisPeloIc(db: Executor = executorPadrao): Promise<Sala[]> {
        const res = await db.query<SalaRow>(
            `SELECT ${COLUNAS_SALA} FROM sala WHERE alocavel_ic = TRUE AND status = 'Disponível' ORDER BY bloco COLLATE "C" ASC, nome COLLATE "C" ASC;`
        );
        return res.rows.map(mapearLinha);
    }
}
