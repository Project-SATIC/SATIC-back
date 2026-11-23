import { comTransacao, executarQuery, type QueryExecutor } from "../connection.ts";
import type { Disciplina } from "../../shared/tipos.ts";

interface DisciplinaRow {
    codigo: string;
    nome: string;
    carga_horaria: number;
    exige_laboratorio: boolean;
}

function mapearLinha(row: DisciplinaRow): Disciplina {
    return {
        codigo: row.codigo,
        nome: row.nome,
        cargaHoraria: Number(row.carga_horaria),
        exigeLaboratorio: Boolean(row.exige_laboratorio),
    };
}

export class DisciplinaRepository {
    async criar(disciplina: Disciplina, executor?: QueryExecutor): Promise<Disciplina> {
        const sql = `
            INSERT INTO disciplina (codigo, nome, carga_horaria, exige_laboratorio)
            VALUES ($1, $2, $3, $4)
            RETURNING codigo, nome, carga_horaria, exige_laboratorio;
        `;
        const res = await executarQuery<DisciplinaRow>(
            sql,
            [disciplina.codigo, disciplina.nome, disciplina.cargaHoraria, disciplina.exigeLaboratorio],
            executor
        );
        return mapearLinha(res.rows[0]);
    }

    async inserir(disciplina: Disciplina, executor?: QueryExecutor): Promise<Disciplina> {
        const sql = `
            INSERT INTO disciplina (codigo, nome, carga_horaria, exige_laboratorio)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (codigo) DO UPDATE
            SET nome = EXCLUDED.nome,
                carga_horaria = EXCLUDED.carga_horaria,
                exige_laboratorio = EXCLUDED.exige_laboratorio
            RETURNING codigo, nome, carga_horaria, exige_laboratorio;
        `;
        const res = await executarQuery<DisciplinaRow>(
            sql,
            [disciplina.codigo, disciplina.nome, disciplina.cargaHoraria, disciplina.exigeLaboratorio],
            executor
        );
        return mapearLinha(res.rows[0]);
    }

    async inserirMuitas(disciplinas: readonly Disciplina[], executor?: QueryExecutor): Promise<void> {
        const executar = async (tx: QueryExecutor): Promise<void> => {
            for (const disc of disciplinas) {
                await this.inserir(disc, tx);
            }
        };

        if (executor) {
            await executar(executor);
            return;
        }
        await comTransacao((client) => executar(client));
    }

    async buscarPorCodigo(codigo: string, executor?: QueryExecutor): Promise<Disciplina | null> {
        const res = await executarQuery<DisciplinaRow>(
            "SELECT codigo, nome, carga_horaria, exige_laboratorio FROM disciplina WHERE codigo = $1;",
            [codigo],
            executor
        );
        if (res.rows.length === 0) return null;
        return mapearLinha(res.rows[0]);
    }

    async listarTodas(executor?: QueryExecutor): Promise<Disciplina[]> {
        const res = await executarQuery<DisciplinaRow>(
            "SELECT codigo, nome, carga_horaria, exige_laboratorio FROM disciplina ORDER BY codigo ASC;",
            undefined,
            executor
        );
        return res.rows.map(mapearLinha);
    }

    async atualizar(
        codigo: string,
        dados: Partial<Omit<Disciplina, "codigo">>,
        executor?: QueryExecutor
    ): Promise<Disciplina | null> {
        const sql = `
            UPDATE disciplina
            SET nome = COALESCE($1, nome),
                carga_horaria = COALESCE($2, carga_horaria),
                exige_laboratorio = COALESCE($3, exige_laboratorio)
            WHERE codigo = $4
            RETURNING codigo, nome, carga_horaria, exige_laboratorio;
        `;
        const res = await executarQuery<DisciplinaRow>(
            sql,
            [
                dados.nome ?? null,
                dados.cargaHoraria ?? null,
                dados.exigeLaboratorio ?? null,
                codigo,
            ],
            executor
        );
        if (res.rows.length === 0) return null;
        return mapearLinha(res.rows[0]);
    }

    async deletar(codigo: string, executor?: QueryExecutor): Promise<boolean> {
        const res = await executarQuery("DELETE FROM disciplina WHERE codigo = $1;", [codigo], executor);
        return (res.rowCount ?? 0) > 0;
    }
}
