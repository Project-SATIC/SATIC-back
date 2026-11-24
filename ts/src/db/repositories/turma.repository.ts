import { comTransacao, executorPadrao, type Executor } from "../connection.ts";
import { obterConjuntoSlots } from "../../shared/horario-sigaa.ts";
import { contarAulas } from "../../shared/grade.ts";
import type { Disciplina, Professor, Turma } from "../../shared/tipos.ts";
import { parseHorarioIndisponivel } from "./professor.repository.ts";

/**
 * Colunas de turma + disciplina usadas por TurmaRepository e AlocacaoRepository.
 * A ordenação usa COLLATE "C" (comparação binária, como o SQLite do Java): a ordem das turmas
 * entra no desempate do MRV, então depender da collation do servidor mudaria o resultado do motor.
 */
export const COLUNAS_TURMA = `
    t.id AS t_id, t.codigo_turma AS t_codigo, t.semestre AS t_semestre,
    t.cursos_ofertados AS t_cursos, t.vagas AS t_vagas,
    t.matriculados AS t_matriculados, t.requer_alocacao_ic AS t_requer_ic,
    t.horario_sigaa AS t_horario, t.aulas_semanais AS t_aulas,
    d.codigo AS d_codigo, d.nome AS d_nome, d.carga_horaria AS d_ch, d.exige_laboratorio AS d_lab
`;

export const ORDEM_TURMAS = `d.codigo COLLATE "C" ASC, t.codigo_turma COLLATE "C" ASC`;

export interface TurmaRow {
    t_id: number;
    t_codigo: string;
    t_semestre: string;
    t_cursos: string;
    t_vagas: number;
    t_matriculados: number;
    t_requer_ic: boolean;
    t_horario: string;
    t_aulas: number | null;
    d_codigo: string;
    d_nome: string;
    d_ch: number;
    d_lab: boolean;
}

interface ProfessorTurmaRow {
    id_turma: number;
    matricula_siape: string;
    nome_docente: string;
    carga_horaria_professor: number;
    horario_indisponivel: string | null;
}

export interface DocentesDaTurma {
    professores: Professor[];
    cargaHorariaPorDocente: Record<string, number>;
}

export interface VinculoDocenteInput {
    matriculaSiape: string;
    cargaHoraria?: number;
}

export interface CriarTurmaInput {
    disciplinaCodigo: string;
    codigoTurma: string;
    semestre: string;
    cursosOfertados: string;
    vagas: number;
    matriculados: number;
    requerAlocacaoIc: boolean;
    horarioSigaa: string;
    aulasSemanais?: number | null;
    professores?: readonly VinculoDocenteInput[];
}

export interface AtualizarTurmaInput {
    codigoTurma?: string;
    semestre?: string;
    cursosOfertados?: string;
    vagas?: number;
    matriculados?: number;
    requerAlocacaoIc?: boolean;
    horarioSigaa?: string;
    aulasSemanais?: number | null;
    professores?: readonly VinculoDocenteInput[];
}

/**
 * Hidratação em lote dos docentes (co-docência N:M) e de suas indisponibilidades (RN-02)
 * para várias turmas numa única consulta, evitando N+1 queries.
 *
 * Sem ela, o validador recebe turmas com `professores: []` e RN-01/RN-02 deixam de ser checadas.
 */
export async function carregarDocentesDasTurmas(
    turmaIds: readonly number[],
    db: Executor = executorPadrao,
): Promise<Map<number, DocentesDaTurma>> {
    const resultado = new Map<number, DocentesDaTurma>();
    const ids = [...new Set(turmaIds.map(Number))];
    if (ids.length === 0) return resultado;

    const res = await db.query<ProfessorTurmaRow>(`
        SELECT pt.id_turma, pt.matricula_siape, pt.carga_horaria_professor,
               p.nome AS nome_docente,
               rh.horario_indisponivel
        FROM professor_turma pt
        JOIN professor p ON pt.matricula_siape = p.matricula_siape
        LEFT JOIN restricoes_horario rh ON p.matricula_siape = rh.matricula_siape
        WHERE pt.id_turma = ANY($1::int[])
        ORDER BY pt.id_turma ASC, p.nome COLLATE "C" ASC, rh.horario_indisponivel COLLATE "C" ASC;
    `, [ids]);

    const profsPorTurma = new Map<number, Map<string, Professor>>();
    for (const row of res.rows) {
        const idTurma = Number(row.id_turma);
        let entrada = resultado.get(idTurma);
        let mapaProfs = profsPorTurma.get(idTurma);
        if (!entrada || !mapaProfs) {
            entrada = { professores: [], cargaHorariaPorDocente: {} };
            mapaProfs = new Map();
            resultado.set(idTurma, entrada);
            profsPorTurma.set(idTurma, mapaProfs);
        }

        let prof = mapaProfs.get(row.matricula_siape);
        if (!prof) {
            prof = { matriculaSiape: row.matricula_siape, nome: row.nome_docente, indisponibilidades: [] };
            mapaProfs.set(row.matricula_siape, prof);
            entrada.professores.push(prof);
        }

        if (row.horario_indisponivel) {
            const ind = parseHorarioIndisponivel(row.matricula_siape, row.horario_indisponivel);
            const repetida = prof.indisponibilidades.some(
                (i) => i.diaSemana === ind.diaSemana && i.turno === ind.turno && i.indiceHorario === ind.indiceHorario,
            );
            if (!repetida) prof.indisponibilidades.push(ind);
        }

        entrada.cargaHorariaPorDocente[row.matricula_siape] = Number(row.carga_horaria_professor);
    }
    return resultado;
}

/** Nº de aulas do horário; null se vazio ou ilegível (ler do banco nunca pode falhar por isso). */
function aulasDoHorarioOuNulo(horario: string): number | null {
    try {
        return contarAulas(horario) || null;
    } catch {
        return null;
    }
}

/** Converte uma linha turma+disciplina em Turma, já com os docentes hidratados. */
export function mapearTurma(r: TurmaRow, docentes: Map<number, DocentesDaTurma>): Turma {
    const disciplina: Disciplina = {
        codigo: r.d_codigo,
        nome: r.d_nome,
        cargaHoraria: Number(r.d_ch),
        exigeLaboratorio: Boolean(r.d_lab),
    };
    const id = Number(r.t_id);
    const doc = docentes.get(id);
    return {
        id,
        disciplina,
        codigoTurma: r.t_codigo,
        semestre: r.t_semestre,
        cursosOfertados: r.t_cursos,
        vagas: Number(r.t_vagas),
        matriculados: Number(r.t_matriculados),
        requerAlocacaoIc: Boolean(r.t_requer_ic),
        horarioSigaa: r.t_horario,
        // Banco antigo (antes da migration 003) ou valor não informado: conta as aulas do horário
        aulasSemanais: r.t_aulas != null ? Number(r.t_aulas) : aulasDoHorarioOuNulo(r.t_horario),
        professores: doc ? doc.professores : [],
        cargaHorariaPorDocente: doc ? doc.cargaHorariaPorDocente : {},
    };
}

async function substituirVinculosDocentes(
    turmaId: number,
    vinculos: readonly VinculoDocenteInput[],
    cargaPadrao: number,
    db: Executor,
): Promise<void> {
    await db.query("DELETE FROM professor_turma WHERE id_turma = $1;", [turmaId]);
    const sqlVinculo = `
        INSERT INTO professor_turma (matricula_siape, id_turma, carga_horaria_professor)
        VALUES ($1, $2, $3)
        ON CONFLICT (matricula_siape, id_turma) DO UPDATE
        SET carga_horaria_professor = EXCLUDED.carga_horaria_professor;
    `;
    for (const v of vinculos) {
        const carga = v.cargaHoraria ?? cargaPadrao;
        await db.query(sqlVinculo, [v.matriculaSiape, turmaId, carga]);
    }
}

export class TurmaRepository {
    async inserir(turma: Turma): Promise<Turma> {
        // Falha cedo com mensagem clara em vez de gravar um horário que o motor não sabe ler
        const aulasNoHorario = obterConjuntoSlots(turma.horarioSigaa).size;
        const aulasSemanais = turma.aulasSemanais ?? (aulasNoHorario > 0 ? aulasNoHorario : null);

        return comTransacao(async (db) => {
            const sqlTurma = `
                INSERT INTO turma (
                    id_disciplina, codigo_turma, semestre, cursos_ofertados,
                    vagas, matriculados, requer_alocacao_ic, horario_sigaa, aulas_semanais
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (semestre, id_disciplina, codigo_turma) DO UPDATE
                SET cursos_ofertados = EXCLUDED.cursos_ofertados,
                    vagas = EXCLUDED.vagas,
                    matriculados = EXCLUDED.matriculados,
                    requer_alocacao_ic = EXCLUDED.requer_alocacao_ic,
                    horario_sigaa = EXCLUDED.horario_sigaa,
                    aulas_semanais = EXCLUDED.aulas_semanais
                RETURNING id;
            `;

            const res = await db.query<{ id: number }>(sqlTurma, [
                turma.disciplina.codigo,
                turma.codigoTurma,
                turma.semestre,
                turma.cursosOfertados,
                turma.vagas,
                turma.matriculados,
                turma.requerAlocacaoIc,
                turma.horarioSigaa,
                aulasSemanais,
            ]);

            const turmaId = Number(res.rows[0].id);
            turma.aulasSemanais = aulasSemanais;
            turma.id = turmaId;

            await substituirVinculosDocentes(
                turmaId,
                turma.professores.map((p) => ({
                    matriculaSiape: p.matriculaSiape,
                    cargaHoraria: turma.cargaHorariaPorDocente?.[p.matriculaSiape],
                })),
                turma.disciplina.cargaHoraria,
                db,
            );

            return turma;
        });
    }

    /** Cria uma nova turma sem sobrescrever (duplicata de chave natural dispara 23505 -> HTTP 409). */
    async criar(dados: CriarTurmaInput): Promise<Turma> {
        const aulasNoHorario = dados.horarioSigaa ? obterConjuntoSlots(dados.horarioSigaa).size : 0;
        const aulasSemanais = dados.aulasSemanais !== undefined
            ? dados.aulasSemanais
            : (aulasNoHorario > 0 ? aulasNoHorario : null);

        return comTransacao(async (db) => {
            const res = await db.query<{ id: number }>(`
                INSERT INTO turma (
                    id_disciplina, codigo_turma, semestre, cursos_ofertados,
                    vagas, matriculados, requer_alocacao_ic, horario_sigaa, aulas_semanais
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id;
            `, [
                dados.disciplinaCodigo,
                dados.codigoTurma,
                dados.semestre,
                dados.cursosOfertados,
                dados.vagas,
                dados.matriculados,
                dados.requerAlocacaoIc,
                dados.horarioSigaa,
                aulasSemanais,
            ]);
            const turmaId = Number(res.rows[0].id);

            if (dados.professores && dados.professores.length > 0) {
                const discRes = await db.query<{ carga_horaria: number }>(
                    "SELECT carga_horaria FROM disciplina WHERE codigo = $1;",
                    [dados.disciplinaCodigo],
                );
                const cargaPadrao = Number(discRes.rows[0]?.carga_horaria ?? 60);
                await substituirVinculosDocentes(turmaId, dados.professores, cargaPadrao, db);
            }

            const criada = await this.buscarPorId(turmaId, db);
            if (!criada) throw new Error(`Turma ${turmaId} não encontrada após inserção`);
            return criada;
        });
    }

    async atualizar(id: number, dados: AtualizarTurmaInput): Promise<Turma | null> {
        if (dados.horarioSigaa !== undefined && dados.horarioSigaa !== "") {
            obterConjuntoSlots(dados.horarioSigaa);
        }

        return comTransacao(async (db) => {
            const atual = await this.buscarPorId(id, db);
            if (!atual) return null;

            const novoHorario = dados.horarioSigaa ?? atual.horarioSigaa;
            const novasAulas = dados.aulasSemanais !== undefined
                ? dados.aulasSemanais
                : (dados.horarioSigaa !== undefined && dados.horarioSigaa !== ""
                    ? aulasDoHorarioOuNulo(dados.horarioSigaa)
                    : atual.aulasSemanais ?? null);

            await db.query(`
                UPDATE turma
                SET codigo_turma = $1,
                    semestre = $2,
                    cursos_ofertados = $3,
                    vagas = $4,
                    matriculados = $5,
                    requer_alocacao_ic = $6,
                    horario_sigaa = $7,
                    aulas_semanais = $8
                WHERE id = $9;
            `, [
                dados.codigoTurma ?? atual.codigoTurma,
                dados.semestre ?? atual.semestre,
                dados.cursosOfertados ?? atual.cursosOfertados,
                dados.vagas ?? atual.vagas,
                dados.matriculados ?? atual.matriculados,
                dados.requerAlocacaoIc ?? atual.requerAlocacaoIc,
                novoHorario,
                novasAulas,
                id,
            ]);

            if (dados.professores !== undefined) {
                await substituirVinculosDocentes(id, dados.professores, atual.disciplina.cargaHoraria, db);
            }

            return this.buscarPorId(id, db);
        });
    }

    async deletar(id: number, db: Executor = executorPadrao): Promise<boolean> {
        const res = await db.query("DELETE FROM turma WHERE id = $1;", [id]);
        return (res.rowCount ?? 0) > 0;
    }

    async inserirMuitas(turmas: readonly Turma[]): Promise<void> {
        for (const turma of turmas) {
            await this.inserir(turma);
        }
    }

    async buscarPorId(id: number, db: Executor = executorPadrao): Promise<Turma | null> {
        const res = await db.query<TurmaRow>(`
            SELECT ${COLUNAS_TURMA}
            FROM turma t
            JOIN disciplina d ON t.id_disciplina = d.codigo
            WHERE t.id = $1;
        `, [id]);
        if (res.rows.length === 0) return null;
        return (await this.#hidratar(res.rows, db))[0] ?? null;
    }

    async listarPorSemestre(semestre: string, db: Executor = executorPadrao): Promise<Turma[]> {
        const res = await db.query<TurmaRow>(`
            SELECT ${COLUNAS_TURMA}
            FROM turma t
            JOIN disciplina d ON t.id_disciplina = d.codigo
            WHERE t.semestre = $1
            ORDER BY ${ORDEM_TURMAS};
        `, [semestre]);
        return this.#hidratar(res.rows, db);
    }

    async listarTodas(db: Executor = executorPadrao): Promise<Turma[]> {
        const res = await db.query<TurmaRow>(`
            SELECT ${COLUNAS_TURMA}
            FROM turma t
            JOIN disciplina d ON t.id_disciplina = d.codigo
            ORDER BY t.semestre COLLATE "C" DESC, ${ORDEM_TURMAS};
        `);
        return this.#hidratar(res.rows, db);
    }

    async #hidratar(rows: TurmaRow[], db: Executor): Promise<Turma[]> {
        const docentes = await carregarDocentesDasTurmas(rows.map((r) => r.t_id), db);
        return rows.map((r) => mapearTurma(r, docentes));
    }
}
