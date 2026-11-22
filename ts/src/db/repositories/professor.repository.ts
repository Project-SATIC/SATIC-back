import { comTransacao, executarQuery, type QueryExecutor } from "../connection.ts";
import type { IndisponibilidadeDocente, Professor } from "../../shared/tipos.ts";

interface ProfessorRow {
    matricula_siape: string;
    nome: string;
}

interface RestricaoRow {
    matricula_siape: string;
    horario_indisponivel: string;
}

export function parseHorarioIndisponivel(matriculaSiape: string, horario: string): IndisponibilidadeDocente {
    const partes = horario.split(/[-:]/);
    if (partes.length === 3) {
        return {
            professorMatricula: matriculaSiape,
            diaSemana: partes[0].toUpperCase(),
            turno: partes[1].toUpperCase(),
            indiceHorario: partes[2],
        };
    }
    const m = horario.match(/^([2-7A-Za-z]+)([MTNmtn])([1-6]+)$/);
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
        diaSemana: horario,
        turno: "",
        indiceHorario: "",
    };
}

export function formatarHorarioIndisponivel(ind: IndisponibilidadeDocente): string {
    return `${ind.diaSemana}-${ind.turno}-${ind.indiceHorario}`;
}

export class ProfessorRepository {
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

            if (professor.indisponibilidades && professor.indisponibilidades.length > 0) {
                for (const ind of professor.indisponibilidades) {
                    const codigoHorario = formatarHorarioIndisponivel(ind);
                    await this.adicionarRestricao(professor.matriculaSiape, codigoHorario, tx);
                }
            }

            return {
                matriculaSiape: res.rows[0].matricula_siape,
                nome: res.rows[0].nome,
                indisponibilidades: professor.indisponibilidades || [],
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
        const sql = `
            INSERT INTO restricoes_horario (matricula_siape, horario_indisponivel)
            VALUES ($1, $2)
            ON CONFLICT (matricula_siape, horario_indisponivel) DO NOTHING;
        `;
        await executarQuery(sql, [matriculaSiape, horarioIndisponivel], executor);
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
