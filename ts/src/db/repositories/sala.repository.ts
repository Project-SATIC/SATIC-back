import { executorPadrao, query, type Executor } from "../connection.ts";
import type { Sala } from "../../shared/tipos.ts";

interface SalaRow {
    id: number;
    nome: string;
    capacidade: number;
    tipo_espaco: string;
    bloco: string;
    alocavel_ic: boolean;
}

export type CriarSalaInput = Omit<Sala, "id">;
export type AtualizarSalaInput = Partial<Omit<Sala, "id">>;

function mapearLinha(row: SalaRow): Sala {
    return {
        id: Number(row.id),
        nome: row.nome,
        capacidade: Number(row.capacidade),
        tipoEspaco: row.tipo_espaco,
        bloco: row.bloco,
        alocavelIc: Boolean(row.alocavel_ic),
    };
}

export class SalaRepository {
    async inserir(sala: Sala): Promise<Sala> {
        const sql = `
            INSERT INTO sala (nome, capacidade, tipo_espaco, bloco, alocavel_ic)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (nome) DO UPDATE
            SET capacidade = EXCLUDED.capacidade,
                tipo_espaco = EXCLUDED.tipo_espaco,
                bloco = EXCLUDED.bloco,
                alocavel_ic = EXCLUDED.alocavel_ic
            RETURNING id, nome, capacidade, tipo_espaco, bloco, alocavel_ic;
        `;
        const res = await query<SalaRow>(sql, [
            sala.nome,
            sala.capacidade,
            sala.tipoEspaco,
            sala.bloco,
            sala.alocavelIc,
        ]);
        return mapearLinha(res.rows[0]);
    }

    /** Insere uma nova sala sem sobrescrever (duplicata de nome dispara erro 23505 -> HTTP 409). */
    async criar(sala: CriarSalaInput, db: Executor = executorPadrao): Promise<Sala> {
        const res = await db.query<SalaRow>(`
            INSERT INTO sala (nome, capacidade, tipo_espaco, bloco, alocavel_ic)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, nome, capacidade, tipo_espaco, bloco, alocavel_ic;
        `, [sala.nome, sala.capacidade, sala.tipoEspaco, sala.bloco, sala.alocavelIc]);
        return mapearLinha(res.rows[0]);
    }

    async atualizar(id: number, dados: AtualizarSalaInput, db: Executor = executorPadrao): Promise<Sala | null> {
        const atual = await this.buscarPorId(id, db);
        if (!atual) return null;

        const res = await db.query<SalaRow>(`
            UPDATE sala
            SET nome = $1,
                capacidade = $2,
                tipo_espaco = $3,
                bloco = $4,
                alocavel_ic = $5
            WHERE id = $6
            RETURNING id, nome, capacidade, tipo_espaco, bloco, alocavel_ic;
        `, [
            dados.nome ?? atual.nome,
            dados.capacidade ?? atual.capacidade,
            dados.tipoEspaco ?? atual.tipoEspaco,
            dados.bloco ?? atual.bloco,
            dados.alocavelIc ?? atual.alocavelIc,
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
            "SELECT id, nome, capacidade, tipo_espaco, bloco, alocavel_ic FROM sala WHERE id = $1;",
            [id]
        );
        if (res.rows.length === 0) return null;
        return mapearLinha(res.rows[0]);
    }

    async buscarPorNome(nome: string): Promise<Sala | null> {
        const res = await query<SalaRow>(
            "SELECT id, nome, capacidade, tipo_espaco, bloco, alocavel_ic FROM sala WHERE nome = $1;",
            [nome]
        );
        if (res.rows.length === 0) return null;
        return mapearLinha(res.rows[0]);
    }

    async listarTodas(db: Executor = executorPadrao): Promise<Sala[]> {
        const res = await db.query<SalaRow>(
            `SELECT id, nome, capacidade, tipo_espaco, bloco, alocavel_ic FROM sala ORDER BY bloco COLLATE "C" ASC, nome COLLATE "C" ASC;`
        );
        return res.rows.map(mapearLinha);
    }

    async listarAlocaveisPeloIc(db: Executor = executorPadrao): Promise<Sala[]> {
        const res = await db.query<SalaRow>(
            `SELECT id, nome, capacidade, tipo_espaco, bloco, alocavel_ic FROM sala WHERE alocavel_ic = TRUE ORDER BY bloco COLLATE "C" ASC, nome COLLATE "C" ASC;`
        );
        return res.rows.map(mapearLinha);
    }
}
