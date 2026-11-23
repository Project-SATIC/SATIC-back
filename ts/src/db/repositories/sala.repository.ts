import { comTransacao, executarQuery, type QueryExecutor } from "../connection.ts";
import type { Sala } from "../../shared/tipos.ts";

interface SalaRow {
    id: number;
    nome: string;
    capacidade: number;
    tipo_espaco: string;
    bloco: string;
    alocavel_ic: boolean;
}

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

export interface FiltroSalas {
    alocavelIc?: boolean;
    bloco?: string;
}

export class SalaRepository {
    async criar(sala: Sala, executor?: QueryExecutor): Promise<Sala> {
        const sql = `
            INSERT INTO sala (nome, capacidade, tipo_espaco, bloco, alocavel_ic)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, nome, capacidade, tipo_espaco, bloco, alocavel_ic;
        `;
        const res = await executarQuery<SalaRow>(
            sql,
            [sala.nome, sala.capacidade, sala.tipoEspaco, sala.bloco, sala.alocavelIc],
            executor
        );
        return mapearLinha(res.rows[0]);
    }

    async inserir(sala: Sala, executor?: QueryExecutor): Promise<Sala> {
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
        const res = await executarQuery<SalaRow>(
            sql,
            [sala.nome, sala.capacidade, sala.tipoEspaco, sala.bloco, sala.alocavelIc],
            executor
        );
        return mapearLinha(res.rows[0]);
    }

    async inserirMuitas(salas: readonly Sala[], executor?: QueryExecutor): Promise<Sala[]> {
        const executar = async (tx: QueryExecutor): Promise<Sala[]> => {
            const inseridas: Sala[] = [];
            for (const sala of salas) {
                inseridas.push(await this.inserir(sala, tx));
            }
            return inseridas;
        };

        if (executor) {
            return executar(executor);
        }
        return comTransacao((client) => executar(client));
    }

    async buscarPorId(id: number, executor?: QueryExecutor): Promise<Sala | null> {
        const res = await executarQuery<SalaRow>(
            "SELECT id, nome, capacidade, tipo_espaco, bloco, alocavel_ic FROM sala WHERE id = $1;",
            [id],
            executor
        );
        if (res.rows.length === 0) return null;
        return mapearLinha(res.rows[0]);
    }

    async buscarPorNome(nome: string, executor?: QueryExecutor): Promise<Sala | null> {
        const res = await executarQuery<SalaRow>(
            "SELECT id, nome, capacidade, tipo_espaco, bloco, alocavel_ic FROM sala WHERE nome = $1;",
            [nome],
            executor
        );
        if (res.rows.length === 0) return null;
        return mapearLinha(res.rows[0]);
    }

    async listar(filtros: FiltroSalas = {}, executor?: QueryExecutor): Promise<Sala[]> {
        const condicoes: string[] = [];
        const params: unknown[] = [];

        if (typeof filtros.alocavelIc === "boolean") {
            params.push(filtros.alocavelIc);
            condicoes.push(`alocavel_ic = $${params.length}`);
        }
        if (typeof filtros.bloco === "string" && filtros.bloco.trim() !== "") {
            params.push(filtros.bloco.trim());
            condicoes.push(`LOWER(bloco) = LOWER($${params.length})`);
        }

        const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";
        const sql = `
            SELECT id, nome, capacidade, tipo_espaco, bloco, alocavel_ic
            FROM sala
            ${where}
            ORDER BY bloco ASC, nome ASC;
        `;
        const res = await executarQuery<SalaRow>(sql, params.length > 0 ? params : undefined, executor);
        return res.rows.map(mapearLinha);
    }

    async listarTodas(executor?: QueryExecutor): Promise<Sala[]> {
        return this.listar({}, executor);
    }

    async listarAlocaveisPeloIc(executor?: QueryExecutor): Promise<Sala[]> {
        return this.listar({ alocavelIc: true }, executor);
    }

    async atualizar(
        id: number,
        dados: Partial<Omit<Sala, "id">>,
        executor?: QueryExecutor
    ): Promise<Sala | null> {
        const sql = `
            UPDATE sala
            SET nome = COALESCE($1, nome),
                capacidade = COALESCE($2, capacidade),
                tipo_espaco = COALESCE($3, tipo_espaco),
                bloco = COALESCE($4, bloco),
                alocavel_ic = COALESCE($5, alocavel_ic)
            WHERE id = $6
            RETURNING id, nome, capacidade, tipo_espaco, bloco, alocavel_ic;
        `;
        const res = await executarQuery<SalaRow>(
            sql,
            [
                dados.nome ?? null,
                dados.capacidade ?? null,
                dados.tipoEspaco ?? null,
                dados.bloco ?? null,
                dados.alocavelIc ?? null,
                id,
            ],
            executor
        );
        if (res.rows.length === 0) return null;
        return mapearLinha(res.rows[0]);
    }

    async deletar(id: number, executor?: QueryExecutor): Promise<boolean> {
        const res = await executarQuery("DELETE FROM sala WHERE id = $1;", [id], executor);
        return (res.rowCount ?? 0) > 0;
    }
}
