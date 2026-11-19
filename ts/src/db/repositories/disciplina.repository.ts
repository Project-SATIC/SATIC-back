import { query } from "../connection.ts";
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

    async inserirMuitas(disciplinas: readonly Disciplina[]): Promise<void> {
        for (const disc of disciplinas) {
            await this.inserir(disc);
        }
    }

    async buscarPorCodigo(codigo: string): Promise<Disciplina | null> {
        const res = await query<DisciplinaRow>(
            "SELECT codigo, nome, carga_horaria, exige_laboratorio FROM disciplina WHERE codigo = $1;",
            [codigo]
        );
        if (res.rows.length === 0) return null;
        return mapearLinha(res.rows[0]);
    }

    async listarTodas(): Promise<Disciplina[]> {
        const res = await query<DisciplinaRow>(
            "SELECT codigo, nome, carga_horaria, exige_laboratorio FROM disciplina ORDER BY codigo COLLATE \"C\" ASC;"
        );
        return res.rows.map(mapearLinha);
    }
}
