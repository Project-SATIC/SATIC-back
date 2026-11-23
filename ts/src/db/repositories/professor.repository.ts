import { comTransacao, executarQuery, type QueryExecutor } from "../connection.ts";
import { DIAS_SIGAA } from "../../shared/horario-sigaa.ts";
import type { IndisponibilidadeDocente, Professor } from "../../shared/tipos.ts";

interface ProfessorRow {
    matricula_siape: string;
    nome: string;
}

interface RestricaoRow {
    matricula_siape: string;
    horario_indisponivel: string;
}

const DIAS_VALIDOS = new Set(["SEG", "TER", "QUA", "QUI", "SEX", "SAB"]);
const TURNOS_VALIDOS = new Set(["M", "T", "N"]);

export function parseHorarioIndisponivel(matriculaSiape: string, horario: string): IndisponibilidadeDocente {
    const limpo = horario.trim();
    const partes = limpo.split(/[-:]/);
    if (partes.length === 3) {
        return {
            professorMatricula: matriculaSiape,
            diaSemana: partes[0].toUpperCase(),
            turno: partes[1].toUpperCase(),
            indiceHorario: partes[2],
        };
    }
    const m = limpo.match(/^([2-7A-Za-z]+)([MTNmtn])([1-6]+)$/);
    if (m) {
        return {
            professorMatricula: matriculaSiape,
            diaSemana: m[1].toUpperCase(),
            turno: m[2].toUpperCase(),
            indiceHorario: m[3],
        };
    }
    return {
        professorMatricula: matriculaSiape,
        diaSemana: limpo,
        turno: "",
        indiceHorario: "",
    };
}

export function formatarHorarioIndisponivel(ind: IndisponibilidadeDocente): string {
    return `${ind.diaSemana}-${ind.turno}-${ind.indiceHorario}`;
}

export function canonicalizarHorarioIndisponivel(horario: string): string | null {
    if (typeof horario !== "string" || horario.trim() === "") return null;
    const parsed = parseHorarioIndisponivel("", horario);
    let dia = parsed.diaSemana.trim().toUpperCase();
    if (DIAS_SIGAA[dia]) {
        dia = DIAS_SIGAA[dia];
    }
    const turno = parsed.turno.trim().toUpperCase();
    const indicesBrutos = parsed.indiceHorario.trim();

    if (!DIAS_VALIDOS.has(dia) || !TURNOS_VALIDOS.has(turno) || !/^[1-6]+$/.test(indicesBrutos)) {
        return null;
    }

    const indicesOrdenados = Array.from(new Set(indicesBrutos.split(""))).sort().join("");
    return `${dia}-${turno}-${indicesOrdenados}`;
}

function deduplicarIndisponibilidades(
    matriculaSiape: string,
    lista: readonly IndisponibilidadeDocente[]
): { codigos: string[]; indisponibilidades: IndisponibilidadeDocente[] } {
    const vistos = new Set<string>();
    const codigos: string[] = [];
    const indisponibilidades: IndisponibilidadeDocente[] = [];

    for (const ind of lista) {
        const bruto = formatarHorarioIndisponivel(ind);
        const canonico = canonicalizarHorarioIndisponivel(bruto) ?? bruto.trim().toUpperCase();
        if (canonico === "" || vistos.has(canonico)) continue;
        vistos.add(canonico);
        codigos.push(canonico);
        indisponibilidades.push(parseHorarioIndisponivel(matriculaSiape, canonico));
    }

    return { codigos, indisponibilidades };
}

export class ProfessorRepository {
    async criar(professor: Professor, executor?: QueryExecutor): Promise<Professor> {
        const executar = async (tx: QueryExecutor): Promise<Professor> => {
            const sqlProf = `
                INSERT INTO professor (matricula_siape, nome)
                VALUES ($1, $2)
                RETURNING matricula_siape, nome;
            `;
            const res = await executarQuery<ProfessorRow>(
                sqlProf,
                [professor.matriculaSiape, professor.nome],
                tx
            );

            const { codigos, indisponibilidades } = deduplicarIndisponibilidades(
                professor.matriculaSiape,
                professor.indisponibilidades || []
            );
            for (const codigoHorario of codigos) {
                await this.adicionarRestricao(professor.matriculaSiape, codigoHorario, tx);
            }

            return {
                matriculaSiape: res.rows[0].matricula_siape,
                nome: res.rows[0].nome,
                indisponibilidades,
            };
        };

        if (executor) {
            return executar(executor);
        }
        return comTransacao((client) => executar(client));
    }

    async inserir(professor: Professor, executor?: QueryExecutor): Promise<Professor> {
        const executar = async (tx: QueryExecutor): Promise<Professor> => {
            const sqlProf = `
                INSERT INTO professor (matricula_siape, nome)
                VALUES ($1, $2)
                ON CONFLICT (matricula_siape) DO UPDATE
                SET nome = EXCLUDED.nome
                RETURNING matricula_siape, nome;
            `;
            const res = await executarQuery<ProfessorRow>(
                sqlProf,
                [professor.matriculaSiape, professor.nome],
                tx
            );

            const { codigos } = deduplicarIndisponibilidades(
                professor.matriculaSiape,
                professor.indisponibilidades || []
            );
            for (const codigoHorario of codigos) {
                await this.adicionarRestricao(professor.matriculaSiape, codigoHorario, tx);
            }

            const indisponibilidades = await this.listarRestricoesPorProfessor(
                professor.matriculaSiape,
                tx
            );

            return {
                matriculaSiape: res.rows[0].matricula_siape,
                nome: res.rows[0].nome,
                indisponibilidades,
            };
        };

        if (executor) {
            return executar(executor);
        }
        return comTransacao((client) => executar(client));
    }

    async inserirMuitos(professores: readonly Professor[], executor?: QueryExecutor): Promise<void> {
        const executar = async (tx: QueryExecutor): Promise<void> => {
            for (const prof of professores) {
                await this.inserir(prof, tx);
            }
        };

        if (executor) {
            await executar(executor);
            return;
        }
        await comTransacao((client) => executar(client));
    }

    async adicionarRestricao(
        matriculaSiape: string,
        horarioIndisponivel: string,
        executor?: QueryExecutor
    ): Promise<void> {
        const canonico =
            canonicalizarHorarioIndisponivel(horarioIndisponivel) ??
            horarioIndisponivel.trim().toUpperCase();
        const sql = `
            INSERT INTO restricoes_horario (matricula_siape, horario_indisponivel)
            VALUES ($1, $2)
            ON CONFLICT (matricula_siape, horario_indisponivel) DO NOTHING;
        `;
        await executarQuery(sql, [matriculaSiape, canonico], executor);
    }

    async removerRestricao(
        matriculaSiape: string,
        horarioIndisponivel: string,
        executor?: QueryExecutor
    ): Promise<boolean> {
        const candidatos = new Set<string>();
        const bruto = horarioIndisponivel.trim();
        if (bruto !== "") {
            candidatos.add(bruto);
            candidatos.add(bruto.toUpperCase());
        }
        const canonico = canonicalizarHorarioIndisponivel(bruto);
        if (canonico) {
            candidatos.add(canonico);
        }
        if (candidatos.size === 0) return false;

        const res = await executarQuery(
            "DELETE FROM restricoes_horario WHERE matricula_siape = $1 AND horario_indisponivel = ANY($2::text[]);",
            [matriculaSiape, Array.from(candidatos)],
            executor
        );
        return (res.rowCount ?? 0) > 0;
    }

    async substituirRestricoes(
        matriculaSiape: string,
        horariosIndisponiveis: readonly string[],
        executor?: QueryExecutor
    ): Promise<IndisponibilidadeDocente[]> {
        const executar = async (tx: QueryExecutor): Promise<IndisponibilidadeDocente[]> => {
            await executarQuery(
                "DELETE FROM restricoes_horario WHERE matricula_siape = $1;",
                [matriculaSiape],
                tx
            );
            const unicos = Array.from(
                new Set(
                    horariosIndisponiveis
                        .map((h) => canonicalizarHorarioIndisponivel(h) ?? h.trim().toUpperCase())
                        .filter((h) => h !== "")
                )
            );
            for (const horario of unicos) {
                await this.adicionarRestricao(matriculaSiape, horario, tx);
            }
            return unicos.map((h) => parseHorarioIndisponivel(matriculaSiape, h));
        };

        if (executor) {
            return executar(executor);
        }
        return comTransacao((client) => executar(client));
    }

    async atualizar(
        matriculaSiape: string,
        dados: { nome?: string; indisponibilidades?: readonly IndisponibilidadeDocente[] },
        executor?: QueryExecutor
    ): Promise<Professor | null> {
        const executar = async (tx: QueryExecutor): Promise<Professor | null> => {
            const res = await executarQuery<ProfessorRow>(
                `
                    UPDATE professor
                    SET nome = COALESCE($1, nome)
                    WHERE matricula_siape = $2
                    RETURNING matricula_siape, nome;
                `,
                [dados.nome ?? null, matriculaSiape],
                tx
            );
            if (res.rows.length === 0) return null;

            const indisponibilidades =
                dados.indisponibilidades !== undefined
                    ? await this.substituirRestricoes(
                          matriculaSiape,
                          dados.indisponibilidades.map(formatarHorarioIndisponivel),
                          tx
                      )
                    : await this.listarRestricoesPorProfessor(matriculaSiape, tx);

            return {
                matriculaSiape: res.rows[0].matricula_siape,
                nome: res.rows[0].nome,
                indisponibilidades,
            };
        };

        if (executor) {
            return executar(executor);
        }
        return comTransacao((client) => executar(client));
    }

    async deletar(matriculaSiape: string, executor?: QueryExecutor): Promise<boolean> {
        const res = await executarQuery(
            "DELETE FROM professor WHERE matricula_siape = $1;",
            [matriculaSiape],
            executor
        );
        return (res.rowCount ?? 0) > 0;
    }

    async listarRestricoesPorProfessor(
        matriculaSiape: string,
        executor?: QueryExecutor
    ): Promise<IndisponibilidadeDocente[]> {
        const res = await executarQuery<RestricaoRow>(
            "SELECT matricula_siape, horario_indisponivel FROM restricoes_horario WHERE matricula_siape = $1;",
            [matriculaSiape],
            executor
        );
        return res.rows.map((r) => parseHorarioIndisponivel(r.matricula_siape, r.horario_indisponivel));
    }

    async buscarPorSiape(matriculaSiape: string, executor?: QueryExecutor): Promise<Professor | null> {
        const res = await executarQuery<ProfessorRow>(
            "SELECT matricula_siape, nome FROM professor WHERE matricula_siape = $1;",
            [matriculaSiape],
            executor
        );
        if (res.rows.length === 0) return null;

        const indisps = await this.listarRestricoesPorProfessor(matriculaSiape, executor);
        return {
            matriculaSiape: res.rows[0].matricula_siape,
            nome: res.rows[0].nome,
            indisponibilidades: indisps,
        };
    }

    async listarTodos(executor?: QueryExecutor): Promise<Professor[]> {
        const resProf = await executarQuery<ProfessorRow>(
            "SELECT matricula_siape, nome FROM professor ORDER BY nome ASC;",
            undefined,
            executor
        );
        const resRestricoes = await executarQuery<RestricaoRow>(
            "SELECT matricula_siape, horario_indisponivel FROM restricoes_horario;",
            undefined,
            executor
        );

        const restricoesPorProf = new Map<string, IndisponibilidadeDocente[]>();
        for (const r of resRestricoes.rows) {
            const list = restricoesPorProf.get(r.matricula_siape) || [];
            list.push(parseHorarioIndisponivel(r.matricula_siape, r.horario_indisponivel));
            restricoesPorProf.set(r.matricula_siape, list);
        }

        return resProf.rows.map((p) => ({
            matriculaSiape: p.matricula_siape,
            nome: p.nome,
            indisponibilidades: restricoesPorProf.get(p.matricula_siape) || [],
        }));
    }
}
