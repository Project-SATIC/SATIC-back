import { executorPadrao, query, type Executor } from "../connection.ts";
import type { Disciplina } from "../../shared/tipos.ts";

interface DisciplinaRow {
    codigo: string;
    nome: string;
    carga_horaria: number;
    exige_laboratorio: boolean;
}

export type AtualizarDisciplinaInput = Partial<Omit<Disciplina, "codigo">>;

function mapearLinha(row: DisciplinaRow): Disciplina {
    return {
        codigo: row.codigo,
        nome: row.nome,
        cargaHoraria: Number(row.carga_horaria),
        exigeLaboratorio: Boolean(row.exige_laboratorio),
    };
}

export class DisciplinaRepository {
    async inserir(disciplina: Disciplina): Promise<Disciplina> {
        const sql = `
            INSERT INTO disciplina (codigo, nome, carga_horaria, exige_laboratorio)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (codigo) DO UPDATE
            SET nome = EXCLUDED.nome,
                carga_horaria = EXCLUDED.carga_horaria,
                exige_laboratorio = EXCLUDED.exige_laboratorio
            RETURNING codigo, nome, carga_horaria, exige_laboratorio;
        `;
        const res = await query<DisciplinaRow>(sql, [
            disciplina.codigo,
            disciplina.nome,
            disciplina.cargaHoraria,
            disciplina.exigeLaboratorio,
        ]);
        return mapearLinha(res.rows[0]);
    }

    /** Insere uma nova disciplina sem sobrescrever (duplicata de código dispara erro 23505 -> HTTP 409). */
    async criar(disciplina: Disciplina, db: Executor = executorPadrao): Promise<Disciplina> {
        const res = await db.query<DisciplinaRow>(`
            INSERT INTO disciplina (codigo, nome, carga_horaria, exige_laboratorio)
            VALUES ($1, $2, $3, $4)
            RETURNING codigo, nome, carga_horaria, exige_laboratorio;
        `, [disciplina.codigo, disciplina.nome, disciplina.cargaHoraria, disciplina.exigeLaboratorio]);
        return mapearLinha(res.rows[0]);
    }

    async atualizar(codigo: string, dados: AtualizarDisciplinaInput, db: Executor = executorPadrao): Promise<Disciplina | null> {
        const atual = await this.buscarPorCodigo(codigo, db);
        if (!atual) return null;

        const res = await db.query<DisciplinaRow>(`
            UPDATE disciplina
            SET nome = $1,
                carga_horaria = $2,
                exige_laboratorio = $3
            WHERE codigo = $4
            RETURNING codigo, nome, carga_horaria, exige_laboratorio;
        `, [
            dados.nome ?? atual.nome,
            dados.cargaHoraria ?? atual.cargaHoraria,
            dados.exigeLaboratorio ?? atual.exigeLaboratorio,
            codigo,
        ]);
        return res.rows.length > 0 ? mapearLinha(res.rows[0]) : null;
    }

    async deletar(codigo: string, db: Executor = executorPadrao): Promise<boolean> {
        const res = await db.query("DELETE FROM disciplina WHERE codigo = $1;", [codigo]);
        return (res.rowCount ?? 0) > 0;
    }

    async inserirMuitas(disciplinas: readonly Disciplina[]): Promise<void> {
        for (const disc of disciplinas) {
            await this.inserir(disc);
        }
    }

    async buscarPorCodigo(codigo: string, db: Executor = executorPadrao): Promise<Disciplina | null> {
        const res = await db.query<DisciplinaRow>(
            "SELECT codigo, nome, carga_horaria, exige_laboratorio FROM disciplina WHERE codigo = $1;",
            [codigo]
        );
        if (res.rows.length === 0) return null;
        return mapearLinha(res.rows[0]);
    }

    async listarTodas(db: Executor = executorPadrao): Promise<Disciplina[]> {
        const res = await db.query<DisciplinaRow>(
            `SELECT codigo, nome, carga_horaria, exige_laboratorio FROM disciplina ORDER BY codigo COLLATE "C" ASC;`
        );
        return res.rows.map(mapearLinha);
    }
}
