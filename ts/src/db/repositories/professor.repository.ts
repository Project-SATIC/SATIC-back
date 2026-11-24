import { comTransacao, executorPadrao, query, type Executor } from "../connection.ts";
import { ErroRequisicao } from "../../erros.ts";
import type { IndisponibilidadeDocente, Professor } from "../../shared/tipos.ts";

interface ProfessorRow {
    matricula_siape: string;
    nome: string;
}

interface RestricaoRow {
    matricula_siape: string;
    horario_indisponivel: string;
}

export interface AtualizarProfessorInput {
    nome?: string;
    indisponibilidades?: readonly string[];
}

const DIA_POR_NUMERO: Record<string, string> = {
    "2": "SEG",
    "3": "TER",
    "4": "QUA",
    "5": "QUI",
    "6": "SEX",
    "7": "SAB",
};

const DIAS_VALIDOS = new Set(Object.values(DIA_POR_NUMERO));

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

/**
 * Normaliza uma janela de indisponibilidade para o formato canônico `DIA-TURNO-INDICES`
 * (ex: `SEX-T-5`, `SEX-T-56`, `SEG-M-12`). Aceita `DIA-TURNO-IND`, `DIA:TURNO:IND` ou SIGAA compacto `6T56`.
 */
export function canonicalizarHorarioIndisponivel(horario: string): string {
    const limpo = String(horario ?? "").trim().toUpperCase();
    if (!limpo) {
        throw new ErroRequisicao("horarioIndisponivel é obrigatório (ex: 'SEX-T-56' ou 'SEG-M-1')");
    }

    let diaBruto: string;
    let turno: string;
    let indicesBrutos: string;

    const partes = limpo.split(/[-:]/);
    if (partes.length === 3) {
        [diaBruto, turno, indicesBrutos] = partes;
    } else {
        const m = limpo.match(/^(SEG|TER|QUA|QUI|SEX|SAB|[2-7])([MTN])([1-6]+)$/);
        if (!m) {
            throw new ErroRequisicao(
                `horarioIndisponivel inválido '${horario}': use formato DIA-TURNO-INDICES (ex: 'SEX-T-56' ou 'SEG-M-1')`
            );
        }
        [, diaBruto, turno, indicesBrutos] = m;
    }

    const dia = DIA_POR_NUMERO[diaBruto] ?? diaBruto;
    if (!DIAS_VALIDOS.has(dia)) {
        throw new ErroRequisicao(`dia inválido em horarioIndisponivel '${horario}': use SEG, TER, QUA, QUI, SEX ou SAB`);
    }
    if (turno !== "M" && turno !== "T" && turno !== "N") {
        throw new ErroRequisicao(`turno inválido em horarioIndisponivel '${horario}': use M, T ou N`);
    }
    if (!/^[1-6]+$/.test(indicesBrutos)) {
        throw new ErroRequisicao(`índices inválidos em horarioIndisponivel '${horario}': use dígitos entre 1 e 6`);
    }
    const maxAula = turno === "N" ? 4 : 6;
    const digitos = [...new Set(indicesBrutos.split(""))].sort();
    if (digitos.some((d) => Number(d) < 1 || Number(d) > maxAula)) {
        throw new ErroRequisicao(`índice fora do turno ${turno} em horarioIndisponivel '${horario}' (máximo ${maxAula})`);
    }

    return `${dia}-${turno}-${digitos.join("")}`;
}

export class ProfessorRepository {
    async inserir(professor: Professor): Promise<Professor> {
        const sqlProf = `
            INSERT INTO professor (matricula_siape, nome)
            VALUES ($1, $2)
            ON CONFLICT (matricula_siape) DO UPDATE
            SET nome = EXCLUDED.nome
            RETURNING matricula_siape, nome;
        `;
        const res = await query<ProfessorRow>(sqlProf, [professor.matriculaSiape, professor.nome]);

        if (professor.indisponibilidades && professor.indisponibilidades.length > 0) {
            for (const ind of professor.indisponibilidades) {
                const codigoHorario = formatarHorarioIndisponivel(ind);
                await this.adicionarRestricao(professor.matriculaSiape, codigoHorario);
            }
        }

        return {
            matriculaSiape: res.rows[0].matricula_siape,
            nome: res.rows[0].nome,
            indisponibilidades: professor.indisponibilidades || [],
        };
    }

    /** Insere novo professor sem sobrescrever (SIAPE duplicado dispara 23505 -> HTTP 409). */
    async criar(dados: { matriculaSiape: string; nome: string; indisponibilidades?: readonly string[] }): Promise<Professor> {
        const restricoesCanonicas = (dados.indisponibilidades ?? []).map(canonicalizarHorarioIndisponivel);
        return comTransacao(async (db) => {
            const res = await db.query<ProfessorRow>(
                "INSERT INTO professor (matricula_siape, nome) VALUES ($1, $2) RETURNING matricula_siape, nome;",
                [dados.matriculaSiape, dados.nome]
            );
            for (const h of restricoesCanonicas) {
                await this.adicionarRestricao(dados.matriculaSiape, h, db);
            }
            const indisps = await this.listarRestricoesPorProfessor(dados.matriculaSiape, db);
            return {
                matriculaSiape: res.rows[0].matricula_siape,
                nome: res.rows[0].nome,
                indisponibilidades: indisps,
            };
        });
    }

    async atualizar(matriculaSiape: string, dados: AtualizarProfessorInput): Promise<Professor | null> {
        const restricoesCanonicas = dados.indisponibilidades !== undefined
            ? dados.indisponibilidades.map(canonicalizarHorarioIndisponivel)
            : undefined;

        return comTransacao(async (db) => {
            const atual = await this.buscarPorSiape(matriculaSiape, db);
            if (!atual) return null;

            const novoNome = dados.nome ?? atual.nome;
            await db.query("UPDATE professor SET nome = $1 WHERE matricula_siape = $2;", [novoNome, matriculaSiape]);

            if (restricoesCanonicas !== undefined) {
                await this.substituirRestricoes(matriculaSiape, restricoesCanonicas, db);
            }

            const indisps = await this.listarRestricoesPorProfessor(matriculaSiape, db);
            return {
                matriculaSiape,
                nome: novoNome,
                indisponibilidades: indisps,
            };
        });
    }

    async deletar(matriculaSiape: string, db: Executor = executorPadrao): Promise<boolean> {
        const res = await db.query("DELETE FROM professor WHERE matricula_siape = $1;", [matriculaSiape]);
        return (res.rowCount ?? 0) > 0;
    }

    async inserirMuitos(professores: readonly Professor[]): Promise<void> {
        for (const prof of professores) {
            await this.inserir(prof);
        }
    }

    async adicionarRestricao(
        matriculaSiape: string,
        horarioIndisponivel: string,
        db: Executor = executorPadrao,
    ): Promise<void> {
        const canonico = canonicalizarHorarioIndisponivel(horarioIndisponivel);
        const sql = `
            INSERT INTO restricoes_horario (matricula_siape, horario_indisponivel)
            VALUES ($1, $2)
            ON CONFLICT (matricula_siape, horario_indisponivel) DO NOTHING;
        `;
        await db.query(sql, [matriculaSiape, canonico]);
    }

    async substituirRestricoes(
        matriculaSiape: string,
        horarios: readonly string[],
        db: Executor = executorPadrao,
    ): Promise<void> {
        const canonicos = [...new Set(horarios.map(canonicalizarHorarioIndisponivel))];
        await db.query("DELETE FROM restricoes_horario WHERE matricula_siape = $1;", [matriculaSiape]);
        for (const h of canonicos) {
            await this.adicionarRestricao(matriculaSiape, h, db);
        }
    }

    /**
     * Remove uma restrição de indisponibilidade. Se o alvo (ex: `SEX-T-5`) fizer parte de uma janela
     * agrupada (ex: `SEX-T-56` vinda do seed), remove apenas os dígitos solicitados e mantém o restante (`SEX-T-6`).
     */
    async removerRestricao(matriculaSiape: string, horarioIndisponivel: string): Promise<boolean> {
        const bruto = String(horarioIndisponivel ?? "").trim().toUpperCase();
        const canonico = canonicalizarHorarioIndisponivel(horarioIndisponivel);
        const alvo = parseHorarioIndisponivel(matriculaSiape, canonico);
        const diaAlvo = DIA_POR_NUMERO[alvo.diaSemana] ?? alvo.diaSemana;
        const digitosRemover = new Set(alvo.indiceHorario.split(""));

        return comTransacao(async (db) => {
            const direto = await db.query(
                "DELETE FROM restricoes_horario WHERE matricula_siape = $1 AND horario_indisponivel = ANY($2::text[]);",
                [matriculaSiape, [...new Set([bruto, canonico])]]
            );
            if ((direto.rowCount ?? 0) > 0) return true;

            const existentes = await db.query<RestricaoRow>(
                "SELECT matricula_siape, horario_indisponivel FROM restricoes_horario WHERE matricula_siape = $1;",
                [matriculaSiape]
            );

            let alterou = false;
            for (const row of existentes.rows) {
                const parsed = parseHorarioIndisponivel(matriculaSiape, row.horario_indisponivel);
                const diaRow = DIA_POR_NUMERO[parsed.diaSemana] ?? parsed.diaSemana;
                if (diaRow !== diaAlvo || parsed.turno !== alvo.turno) continue;

                const digitosRow = parsed.indiceHorario.split("");
                const restantes = digitosRow.filter((d) => !digitosRemover.has(d));
                if (restantes.length === digitosRow.length) continue;

                alterou = true;
                await db.query(
                    "DELETE FROM restricoes_horario WHERE matricula_siape = $1 AND horario_indisponivel = $2;",
                    [matriculaSiape, row.horario_indisponivel]
                );
                if (restantes.length > 0) {
                    const novoCodigo = `${diaRow}-${parsed.turno}-${[...new Set(restantes)].sort().join("")}`;
                    await this.adicionarRestricao(matriculaSiape, novoCodigo, db);
                }
            }
            return alterou;
        });
    }

    async listarRestricoesPorProfessor(
        matriculaSiape: string,
        db: Executor = executorPadrao,
    ): Promise<IndisponibilidadeDocente[]> {
        const res = await db.query<RestricaoRow>(
            `SELECT matricula_siape, horario_indisponivel FROM restricoes_horario WHERE matricula_siape = $1 ORDER BY horario_indisponivel COLLATE "C" ASC;`,
            [matriculaSiape]
        );
        return res.rows.map((r) => parseHorarioIndisponivel(r.matricula_siape, r.horario_indisponivel));
    }

    async buscarPorSiape(matriculaSiape: string, db: Executor = executorPadrao): Promise<Professor | null> {
        const res = await db.query<ProfessorRow>(
            "SELECT matricula_siape, nome FROM professor WHERE matricula_siape = $1;",
            [matriculaSiape]
        );
        if (res.rows.length === 0) return null;

        const indisps = await this.listarRestricoesPorProfessor(matriculaSiape, db);
        return {
            matriculaSiape: res.rows[0].matricula_siape,
            nome: res.rows[0].nome,
            indisponibilidades: indisps,
        };
    }

    async listarTodos(db: Executor = executorPadrao): Promise<Professor[]> {
        const resProf = await db.query<ProfessorRow>(
            `SELECT matricula_siape, nome FROM professor ORDER BY nome COLLATE "C" ASC;`
        );
        const resRestricoes = await db.query<RestricaoRow>(
            `SELECT matricula_siape, horario_indisponivel FROM restricoes_horario ORDER BY horario_indisponivel COLLATE "C" ASC;`
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
