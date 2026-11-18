import { getClient, query } from "../connection.ts";
import type { Alocacao, Disciplina, Sala, StatusAlocacao, Turma } from "../../shared/tipos.ts";

interface AlocacaoRow {
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

export class AlocacaoRepository {
    async inserir(alocacao: Alocacao): Promise<Alocacao> {
        if (!alocacao.turma.id) throw new Error("Turma deve possuir id para ser alocada");
        if (!alocacao.sala.id) throw new Error("Sala deve possuir id para ser alocada");

        const sql = `
            INSERT INTO alocacao (id_turma, id_sala, horario_codigo, status)
            VALUES ($1, $2, $3, $4)
            RETURNING id, data_geracao;
        `;
        const res = await query<{ id: number; data_geracao: Date }>(sql, [
            alocacao.turma.id,
            alocacao.sala.id,
            alocacao.horarioCodigo,
            alocacao.status || "RASCUNHO",
        ]);

        alocacao.id = res.rows[0].id;
        alocacao.dataGeracao = res.rows[0].data_geracao.toISOString();
        return alocacao;
    }

    async inserirMuitas(alocacoes: readonly Alocacao[]): Promise<void> {
        const client = await getClient();
        try {
            await client.query("BEGIN;");
            const sql = `
                INSERT INTO alocacao (id_turma, id_sala, horario_codigo, status)
                VALUES ($1, $2, $3, $4)
                RETURNING id;
            `;
            for (const aloc of alocacoes) {
                if (!aloc.turma.id || !aloc.sala.id) continue;
                const res = await client.query<{ id: number }>(sql, [
                    aloc.turma.id,
                    aloc.sala.id,
                    aloc.horarioCodigo,
                    aloc.status || "RASCUNHO",
                ]);
                aloc.id = res.rows[0].id;
            }
            await client.query("COMMIT;");
        } catch (err) {
            await client.query("ROLLBACK;");
            throw err;
        } finally {
            client.release();
        }
    }

    async listarTodas(): Promise<Alocacao[]> {
        const sql = `
            SELECT a.id AS a_id, a.horario_codigo AS a_horario, a.status AS a_status, a.data_geracao AS a_data,
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
        const res = await query<AlocacaoRow>(sql);
        return this.mapearAlocacoes(res.rows);
    }

    async listarPorSemestre(semestre: string): Promise<Alocacao[]> {
        const sql = `
            SELECT a.id AS a_id, a.horario_codigo AS a_horario, a.status AS a_status, a.data_geracao AS a_data,
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
        const res = await query<AlocacaoRow>(sql, [semestre]);
        return this.mapearAlocacoes(res.rows);
    }

    async buscarPorTurmaId(turmaId: number): Promise<Alocacao | null> {
        const sql = `
            SELECT a.id AS a_id, a.horario_codigo AS a_horario, a.status AS a_status, a.data_geracao AS a_data,
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
        const res = await query<AlocacaoRow>(sql, [turmaId]);
        if (res.rows.length === 0) return null;
        return this.mapearAlocacoes(res.rows)[0] || null;
    }

    async atualizarSalaEHorario(
        alocacaoId: number,
        novaSalaId: number,
        novoHorario: string,
        novoStatus?: StatusAlocacao
    ): Promise<boolean> {
        const sql = `
            UPDATE alocacao
            SET id_sala = $1,
                horario_codigo = $2,
                status = COALESCE($3, status)
            WHERE id = $4;
        `;
        const res = await query(sql, [novaSalaId, novoHorario, novoStatus || null, alocacaoId]);
        return (res.rowCount ?? 0) > 0;
    }

    async limparPorSemestre(semestre: string): Promise<number> {
        const sql = `
            DELETE FROM alocacao
            WHERE id_turma IN (SELECT id FROM turma WHERE semestre = $1);
        `;
        const res = await query(sql, [semestre]);
        return res.rowCount ?? 0;
    }

    private mapearAlocacoes(rows: AlocacaoRow[]): Alocacao[] {
        const cacheTurmas = new Map<number, Turma>();

        return rows.map((r) => {
            const sala: Sala = {
                id: Number(r.s_id),
                nome: r.s_nome,
                capacidade: Number(r.s_cap),
                tipoEspaco: r.s_tipo,
                bloco: r.s_bloco,
                alocavelIc: Boolean(r.s_alocavel),
            };

            let turma = cacheTurmas.get(r.t_id);
            if (!turma) {
                const disc: Disciplina = {
                    codigo: r.d_codigo,
                    nome: r.d_nome,
                    cargaHoraria: Number(r.d_ch),
                    exigeLaboratorio: Boolean(r.d_lab),
                };

                turma = {
                    id: Number(r.t_id),
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
                cacheTurmas.set(r.t_id, turma);
            }

            return {
                id: Number(r.a_id),
                turma,
                sala,
                horarioCodigo: r.a_horario,
                status: r.a_status as StatusAlocacao,
                dataGeracao: r.a_data instanceof Date ? r.a_data.toISOString() : String(r.a_data),
            };
        });
    }
}
