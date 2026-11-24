import { comTransacao, executorPadrao, query, type Executor } from "../connection.ts";
import { ErroRequisicao } from "../../erros.ts";
import type { IndisponibilidadeDocente, Professor } from "../../shared/tipos.ts";

interface ProfessorRow {
    matricula_siape: string;
    nome: string;
    regime?: string | null;
    carga_max?: number | null;
}

interface RestricaoRow {
    matricula_siape: string;
    horario_indisponivel: string;
}

interface PreferenciaRow {
    matricula_siape: string;
    horario_preferencial: string;
}

export type EstadoDisponibilidadeDocente = "disponivel" | "preferencial" | "indisponivel";

export interface AtualizarProfessorInput {
    nome?: string;
    regime?: string | null;
    cargaMax?: number | null;
    indisponibilidades?: readonly string[];
    preferencias?: readonly string[];
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
 * Normaliza uma janela de indisponibilidade ou preferência para o formato canônico `DIA-TURNO-INDICES`
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

async function removerJanelaTabela(
    tabela: "restricoes_horario" | "preferencias_horario",
    coluna: "horario_indisponivel" | "horario_preferencial",
    matriculaSiape: string,
    horarioAlvo: string,
    db: Executor,
): Promise<boolean> {
    const bruto = String(horarioAlvo ?? "").trim().toUpperCase();
    const canonico = canonicalizarHorarioIndisponivel(horarioAlvo);
    const alvo = parseHorarioIndisponivel(matriculaSiape, canonico);
    const diaAlvo = DIA_POR_NUMERO[alvo.diaSemana] ?? alvo.diaSemana;
    const digitosRemover = new Set(alvo.indiceHorario.split(""));

    const direto = await db.query(
        `DELETE FROM ${tabela} WHERE matricula_siape = $1 AND ${coluna} = ANY($2::text[]);`,
        [matriculaSiape, [...new Set([bruto, canonico])]],
    );
    let alterou = (direto.rowCount ?? 0) > 0;

    const existentes = await db.query<Record<string, string>>(
        `SELECT ${coluna} AS codigo FROM ${tabela} WHERE matricula_siape = $1;`,
        [matriculaSiape],
    );

    for (const row of existentes.rows) {
        const parsed = parseHorarioIndisponivel(matriculaSiape, row.codigo);
        const diaRow = DIA_POR_NUMERO[parsed.diaSemana] ?? parsed.diaSemana;
        if (diaRow !== diaAlvo || parsed.turno !== alvo.turno) continue;

        const digitosRow = parsed.indiceHorario.split("");
        const restantes = digitosRow.filter((d) => !digitosRemover.has(d));
        if (restantes.length === digitosRow.length) continue;

        alterou = true;
        await db.query(
            `DELETE FROM ${tabela} WHERE matricula_siape = $1 AND ${coluna} = $2;`,
            [matriculaSiape, row.codigo],
        );
        if (restantes.length > 0) {
            const novoCodigo = `${diaRow}-${parsed.turno}-${[...new Set(restantes)].sort().join("")}`;
            await db.query(
                `INSERT INTO ${tabela} (matricula_siape, ${coluna}) VALUES ($1, $2) ON CONFLICT DO NOTHING;`,
                [matriculaSiape, novoCodigo],
            );
        }
    }
    return alterou;
}

export class ProfessorRepository {
    async inserir(professor: Professor): Promise<Professor> {
        const sqlProf = `
            INSERT INTO professor (matricula_siape, nome, regime, carga_max)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (matricula_siape) DO UPDATE
            SET nome = EXCLUDED.nome,
                regime = COALESCE(professor.regime, EXCLUDED.regime),
                carga_max = COALESCE(professor.carga_max, EXCLUDED.carga_max)
            RETURNING matricula_siape, nome, regime, carga_max;
        `;
        const res = await query<ProfessorRow>(sqlProf, [
            professor.matriculaSiape,
            professor.nome,
            professor.regime ?? null,
            professor.cargaMax ?? null,
        ]);

        if (professor.indisponibilidades && professor.indisponibilidades.length > 0) {
            for (const ind of professor.indisponibilidades) {
                const codigoHorario = formatarHorarioIndisponivel(ind);
                await this.adicionarRestricao(professor.matriculaSiape, codigoHorario);
            }
        }
        if (professor.preferencias && professor.preferencias.length > 0) {
            for (const pref of professor.preferencias) {
                const codigoHorario = formatarHorarioIndisponivel(pref);
                await this.adicionarPreferencia(professor.matriculaSiape, codigoHorario);
            }
        }

        return {
            matriculaSiape: res.rows[0].matricula_siape,
            nome: res.rows[0].nome,
            regime: res.rows[0].regime ?? null,
            cargaMax: res.rows[0].carga_max != null ? Number(res.rows[0].carga_max) : null,
            indisponibilidades: professor.indisponibilidades || [],
            preferencias: professor.preferencias || [],
        };
    }

    /** Insere novo professor sem sobrescrever (SIAPE duplicado dispara 23505 -> HTTP 409). */
    async criar(dados: {
        matriculaSiape: string;
        nome: string;
        regime?: string | null;
        cargaMax?: number | null;
        indisponibilidades?: readonly string[];
        preferencias?: readonly string[];
    }): Promise<Professor> {
        const restricoesCanonicas = (dados.indisponibilidades ?? []).map(canonicalizarHorarioIndisponivel);
        const preferenciasCanonicas = (dados.preferencias ?? []).map(canonicalizarHorarioIndisponivel);
        return comTransacao(async (db) => {
            const res = await db.query<ProfessorRow>(
                "INSERT INTO professor (matricula_siape, nome, regime, carga_max) VALUES ($1, $2, $3, $4) RETURNING matricula_siape, nome, regime, carga_max;",
                [dados.matriculaSiape, dados.nome, dados.regime ?? null, dados.cargaMax ?? null]
            );
            for (const h of preferenciasCanonicas) {
                await this.adicionarPreferencia(dados.matriculaSiape, h, db);
            }
            for (const h of restricoesCanonicas) {
                await this.adicionarRestricao(dados.matriculaSiape, h, db);
            }
            const [indisps, prefs] = await Promise.all([
                this.listarRestricoesPorProfessor(dados.matriculaSiape, db),
                this.listarPreferenciasPorProfessor(dados.matriculaSiape, db),
            ]);
            return {
                matriculaSiape: res.rows[0].matricula_siape,
                nome: res.rows[0].nome,
                regime: res.rows[0].regime ?? null,
                cargaMax: res.rows[0].carga_max != null ? Number(res.rows[0].carga_max) : null,
                indisponibilidades: indisps,
                preferencias: prefs,
            };
        });
    }

    async atualizar(matriculaSiape: string, dados: AtualizarProfessorInput): Promise<Professor | null> {
        const restricoesCanonicas = dados.indisponibilidades !== undefined
            ? dados.indisponibilidades.map(canonicalizarHorarioIndisponivel)
            : undefined;
        const preferenciasCanonicas = dados.preferencias !== undefined
            ? dados.preferencias.map(canonicalizarHorarioIndisponivel)
            : undefined;

        return comTransacao(async (db) => {
            const atual = await this.buscarPorSiape(matriculaSiape, db);
            if (!atual) return null;

            const novoNome = dados.nome ?? atual.nome;
            const novoRegime = dados.regime !== undefined ? dados.regime : (atual.regime ?? null);
            const novaCargaMax = dados.cargaMax !== undefined ? dados.cargaMax : (atual.cargaMax ?? null);
            await db.query(
                "UPDATE professor SET nome = $1, regime = $2, carga_max = $3 WHERE matricula_siape = $4;",
                [novoNome, novoRegime, novaCargaMax, matriculaSiape],
            );

            if (preferenciasCanonicas !== undefined) {
                await this.substituirPreferencias(matriculaSiape, preferenciasCanonicas, db);
            }
            if (restricoesCanonicas !== undefined) {
                await this.substituirRestricoes(matriculaSiape, restricoesCanonicas, db);
            }

            const [indisps, prefs] = await Promise.all([
                this.listarRestricoesPorProfessor(matriculaSiape, db),
                this.listarPreferenciasPorProfessor(matriculaSiape, db),
            ]);
            return {
                matriculaSiape,
                nome: novoNome,
                regime: novoRegime,
                cargaMax: novaCargaMax,
                indisponibilidades: indisps,
                preferencias: prefs,
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
        db?: Executor,
    ): Promise<void> {
        const canonico = canonicalizarHorarioIndisponivel(horarioIndisponivel);
        const exec = async (tx: Executor) => {
            await removerJanelaTabela("preferencias_horario", "horario_preferencial", matriculaSiape, canonico, tx);
            await removerJanelaTabela("restricoes_horario", "horario_indisponivel", matriculaSiape, canonico, tx);
            await tx.query(`
                INSERT INTO restricoes_horario (matricula_siape, horario_indisponivel)
                VALUES ($1, $2)
                ON CONFLICT (matricula_siape, horario_indisponivel) DO NOTHING;
            `, [matriculaSiape, canonico]);
        };
        if (db) await exec(db);
        else await comTransacao(exec);
    }

    async adicionarPreferencia(
        matriculaSiape: string,
        horarioPreferencial: string,
        db?: Executor,
    ): Promise<void> {
        const canonico = canonicalizarHorarioIndisponivel(horarioPreferencial);
        const exec = async (tx: Executor) => {
            await removerJanelaTabela("restricoes_horario", "horario_indisponivel", matriculaSiape, canonico, tx);
            await removerJanelaTabela("preferencias_horario", "horario_preferencial", matriculaSiape, canonico, tx);
            await tx.query(`
                INSERT INTO preferencias_horario (matricula_siape, horario_preferencial)
                VALUES ($1, $2)
                ON CONFLICT (matricula_siape, horario_preferencial) DO NOTHING;
            `, [matriculaSiape, canonico]);
        };
        if (db) await exec(db);
        else await comTransacao(exec);
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

    async substituirPreferencias(
        matriculaSiape: string,
        horarios: readonly string[],
        db: Executor = executorPadrao,
    ): Promise<void> {
        const canonicos = [...new Set(horarios.map(canonicalizarHorarioIndisponivel))];
        await db.query("DELETE FROM preferencias_horario WHERE matricula_siape = $1;", [matriculaSiape]);
        for (const h of canonicos) {
            await this.adicionarPreferencia(matriculaSiape, h, db);
        }
    }

    /**
     * Remove uma restrição de indisponibilidade. Se o alvo (ex: `SEX-T-5`) fizer parte de uma janela
     * agrupada (ex: `SEX-T-56` vinda do seed), remove apenas os dígitos solicitados e mantém o restante (`SEX-T-6`).
     */
    async removerRestricao(matriculaSiape: string, horarioIndisponivel: string, db?: Executor): Promise<boolean> {
        const exec = (tx: Executor) =>
            removerJanelaTabela("restricoes_horario", "horario_indisponivel", matriculaSiape, horarioIndisponivel, tx);
        return db ? exec(db) : comTransacao(exec);
    }

    async removerPreferencia(matriculaSiape: string, horarioPreferencial: string, db?: Executor): Promise<boolean> {
        const exec = (tx: Executor) =>
            removerJanelaTabela("preferencias_horario", "horario_preferencial", matriculaSiape, horarioPreferencial, tx);
        return db ? exec(db) : comTransacao(exec);
    }

    /**
     * Define de forma atômica o estado de uma janela (`disponivel`, `preferencial` ou `indisponivel`),
     * sincronizando as tabelas `restricoes_horario` e `preferencias_horario`.
     */
    async definirDisponibilidadeSlot(
        matriculaSiape: string,
        horario: string,
        estado: EstadoDisponibilidadeDocente,
    ): Promise<{
        horario: string;
        estado: EstadoDisponibilidadeDocente;
        indisponibilidades: IndisponibilidadeDocente[];
        preferencias: IndisponibilidadeDocente[];
    }> {
        const canonico = canonicalizarHorarioIndisponivel(horario);
        return comTransacao(async (db) => {
            if (estado === "disponivel") {
                await removerJanelaTabela("restricoes_horario", "horario_indisponivel", matriculaSiape, canonico, db);
                await removerJanelaTabela("preferencias_horario", "horario_preferencial", matriculaSiape, canonico, db);
            } else if (estado === "preferencial") {
                await this.adicionarPreferencia(matriculaSiape, canonico, db);
            } else if (estado === "indisponivel") {
                await this.adicionarRestricao(matriculaSiape, canonico, db);
            } else {
                throw new ErroRequisicao("estado deve ser 'disponivel', 'preferencial' ou 'indisponivel'");
            }

            const [indisponibilidades, preferencias] = await Promise.all([
                this.listarRestricoesPorProfessor(matriculaSiape, db),
                this.listarPreferenciasPorProfessor(matriculaSiape, db),
            ]);
            return { horario: canonico, estado, indisponibilidades, preferencias };
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

    async listarPreferenciasPorProfessor(
        matriculaSiape: string,
        db: Executor = executorPadrao,
    ): Promise<IndisponibilidadeDocente[]> {
        const res = await db.query<PreferenciaRow>(
            `SELECT matricula_siape, horario_preferencial FROM preferencias_horario WHERE matricula_siape = $1 ORDER BY horario_preferencial COLLATE "C" ASC;`,
            [matriculaSiape]
        );
        return res.rows.map((r) => parseHorarioIndisponivel(r.matricula_siape, r.horario_preferencial));
    }

    async buscarPorSiape(matriculaSiape: string, db: Executor = executorPadrao): Promise<Professor | null> {
        const res = await db.query<ProfessorRow>(
            "SELECT matricula_siape, nome, regime, carga_max FROM professor WHERE matricula_siape = $1;",
            [matriculaSiape]
        );
        if (res.rows.length === 0) return null;

        const [indisps, prefs] = await Promise.all([
            this.listarRestricoesPorProfessor(matriculaSiape, db),
            this.listarPreferenciasPorProfessor(matriculaSiape, db),
        ]);
        return {
            matriculaSiape: res.rows[0].matricula_siape,
            nome: res.rows[0].nome,
            regime: res.rows[0].regime ?? null,
            cargaMax: res.rows[0].carga_max != null ? Number(res.rows[0].carga_max) : null,
            indisponibilidades: indisps,
            preferencias: prefs,
        };
    }

    async listarTodos(db: Executor = executorPadrao): Promise<Professor[]> {
        const resProf = await db.query<ProfessorRow>(
            `SELECT matricula_siape, nome, regime, carga_max FROM professor ORDER BY nome COLLATE "C" ASC;`
        );
        const [resRestricoes, resPreferencias] = await Promise.all([
            db.query<RestricaoRow>(
                `SELECT matricula_siape, horario_indisponivel FROM restricoes_horario ORDER BY horario_indisponivel COLLATE "C" ASC;`
            ),
            db.query<PreferenciaRow>(
                `SELECT matricula_siape, horario_preferencial FROM preferencias_horario ORDER BY horario_preferencial COLLATE "C" ASC;`
            ),
        ]);

        const restricoesPorProf = new Map<string, IndisponibilidadeDocente[]>();
        for (const r of resRestricoes.rows) {
            const list = restricoesPorProf.get(r.matricula_siape) || [];
            list.push(parseHorarioIndisponivel(r.matricula_siape, r.horario_indisponivel));
            restricoesPorProf.set(r.matricula_siape, list);
        }

        const preferenciasPorProf = new Map<string, IndisponibilidadeDocente[]>();
        for (const r of resPreferencias.rows) {
            const list = preferenciasPorProf.get(r.matricula_siape) || [];
            list.push(parseHorarioIndisponivel(r.matricula_siape, r.horario_preferencial));
            preferenciasPorProf.set(r.matricula_siape, list);
        }

        return resProf.rows.map((p) => ({
            matriculaSiape: p.matricula_siape,
            nome: p.nome,
            regime: p.regime ?? null,
            cargaMax: p.carga_max != null ? Number(p.carga_max) : null,
            indisponibilidades: restricoesPorProf.get(p.matricula_siape) || [],
            preferencias: preferenciasPorProf.get(p.matricula_siape) || [],
        }));
    }
}
