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

export class SalaRepository {
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

    async listarTodas(executor?: QueryExecutor): Promise<Sala[]> {
        const res = await executarQuery<SalaRow>(
            "SELECT id, nome, capacidade, tipo_espaco, bloco, alocavel_ic FROM sala ORDER BY bloco ASC, nome ASC;",
            undefined,
            executor
        );
        return res.rows.map(mapearLinha);
    }

    async listarAlocaveisPeloIc(executor?: QueryExecutor): Promise<Sala[]> {
        const res = await executarQuery<SalaRow>(
            "SELECT id, nome, capacidade, tipo_espaco, bloco, alocavel_ic FROM sala WHERE alocavel_ic = TRUE ORDER BY bloco ASC, nome ASC;",
            undefined,
            executor
        );
        return res.rows.map(mapearLinha);
    }
}
