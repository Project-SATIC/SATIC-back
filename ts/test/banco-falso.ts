/**
 * Banco em memória que responde às consultas SQL emitidas pelos repositórios do SATIC.
 *
 * Não é um PostgreSQL: reconhece cada consulta pelo seu formato e devolve linhas com as mesmas
 * colunas que o PostgreSQL devolveria (aliases t_*, d_*, s_*, a_*). Serve para testar, sem banco,
 * o mapeamento linha -> entidade, a hidratação de docentes e as regras dos serviços.
 * Reproduz a UNIQUE (id_turma) da migration 002 e a ordenação COLLATE "C".
 * Consultas desconhecidas lançam erro, para que uma mudança de SQL não passe despercebida.
 */
import type { Executor } from "../src/db/connection.ts";
import type { BaseSatic } from "../src/seed/seeder.ts";
import { montarProblema } from "../src/motor/montar-problema.ts";
import { formatarHorarioIndisponivel } from "../src/db/repositories/professor.repository.ts";
import type { Sala, StatusAlocacao, Turma } from "../src/shared/tipos.ts";

interface LinhaAlocacao {
    id: number;
    turmaId: number;
    salaId: number;
    horario: string;
    status: StatusAlocacao;
    data: Date;
}

const bin = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export class BancoFalso implements Executor {
    readonly salas: Sala[] = [];
    readonly turmas: Turma[] = [];
    readonly alocacoes: LinhaAlocacao[] = [];
    readonly locks: string[] = [];
    readonly sqls: string[] = [];
    #proximoIdAlocacao = 1;

    static daBase(base: BaseSatic, opcoes: { comReservasExternas?: boolean } = {}): BancoFalso {
        const banco = new BancoFalso();
        banco.salas.push(...base.salas);
        banco.turmas.push(...base.turmas);
        if (opcoes.comReservasExternas ?? true) {
            for (const r of montarProblema(base).reservasFixasExternas) {
                banco.inserirAlocacao(r.turma.id!, r.sala.id!, r.horarioCodigo, "EXTERNA_FIXA");
            }
        }
        return banco;
    }

    inserirAlocacao(turmaId: number, salaId: number, horario: string, status: StatusAlocacao): LinhaAlocacao {
        if (this.alocacoes.some((a) => a.turmaId === turmaId)) {
            throw new Error(`duplicate key value violates unique constraint "uq_alocacao_turma" (id_turma=${turmaId})`);
        }
        const linha = { id: this.#proximoIdAlocacao++, turmaId, salaId, horario, status, data: new Date("2026-11-18T12:00:00Z") };
        this.alocacoes.push(linha);
        return linha;
    }

    contarPorStatus(): Record<string, number> {
        const c: Record<string, number> = {};
        for (const a of this.alocacoes) c[a.status] = (c[a.status] ?? 0) + 1;
        return c;
    }

    async query(sql: string, params: unknown[] = []): Promise<never> {
        const s = sql.replace(/\s+/g, " ").trim();
        this.sqls.push(s);
        const rows = this.#executar(s, params);
        return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] } as never;
    }

    #executar(s: string, p: unknown[]): Record<string, unknown>[] {
        if (s.startsWith("SELECT pg_advisory_xact_lock")) {
            this.locks.push(String(p[0]));
            return [];
        }
        if (s.includes("FROM professor_turma pt")) {
            const ids = new Set((p[0] as number[]).map(Number));
            const rows: Record<string, unknown>[] = [];
            for (const t of this.turmas.filter((x) => ids.has(x.id!)).sort((a, b) => a.id! - b.id!)) {
                for (const prof of [...t.professores].sort((a, b) => bin(a.nome, b.nome))) {
                    const base = {
                        id_turma: t.id, matricula_siape: prof.matriculaSiape, nome_docente: prof.nome,
                        carga_horaria_professor: t.cargaHorariaPorDocente[prof.matriculaSiape] ?? t.disciplina.cargaHoraria,
                    };
                    if (prof.indisponibilidades.length === 0) rows.push({ ...base, horario_indisponivel: null });
                    for (const ind of prof.indisponibilidades) rows.push({ ...base, horario_indisponivel: formatarHorarioIndisponivel(ind) });
                }
            }
            return rows;
        }
        if (s.startsWith("SELECT a.id AS a_id")) {
            let linhas = [...this.alocacoes];
            if (s.includes("WHERE t.semestre = $1")) linhas = linhas.filter((a) => this.#turma(a.turmaId).semestre === p[0]);
            else if (s.includes("WHERE a.id = $1")) linhas = linhas.filter((a) => a.id === Number(p[0]));
            else if (s.includes("WHERE a.id_turma = $1")) linhas = linhas.filter((a) => a.turmaId === Number(p[0])).sort((a, b) => b.id - a.id).slice(0, 1);
            if (!s.includes("WHERE a.id_turma") && !s.includes("WHERE a.id = $1")) {
                linhas.sort((a, b) => bin(a.horario, b.horario) || bin(this.#sala(a.salaId).nome, this.#sala(b.salaId).nome) || a.id - b.id);
            }
            return linhas.map((a) => this.#linhaAlocacao(a));
        }
        if (s.startsWith("SELECT status FROM alocacao WHERE id = $1")) {
            const a = this.alocacoes.find((x) => x.id === Number(p[0]));
            return a ? [{ status: a.status }] : [];
        }
        if (s.includes("FROM turma t JOIN disciplina d")) {
            let turmas = [...this.turmas];
            if (s.includes("WHERE t.id = $1")) turmas = turmas.filter((t) => t.id === Number(p[0]));
            else if (s.includes("WHERE t.semestre = $1")) turmas = turmas.filter((t) => t.semestre === p[0]);
            turmas.sort((a, b) => bin(a.disciplina.codigo, b.disciplina.codigo) || bin(a.codigoTurma, b.codigoTurma));
            return turmas.map((t) => this.#linhaTurma(t));
        }
        if (s.startsWith("SELECT id, nome, capacidade, tipo_espaco, bloco, alocavel_ic FROM sala")) {
            let salas = [...this.salas];
            if (s.includes("WHERE id = $1")) salas = salas.filter((x) => x.id === Number(p[0]));
            if (s.includes("WHERE alocavel_ic = TRUE")) salas = salas.filter((x) => x.alocavelIc);
            salas.sort((a, b) => bin(a.bloco, b.bloco) || bin(a.nome, b.nome));
            return salas.map((x) => ({ id: x.id, nome: x.nome, capacidade: x.capacidade, tipo_espaco: x.tipoEspaco, bloco: x.bloco, alocavel_ic: x.alocavelIc }));
        }
        if (s.startsWith("INSERT INTO alocacao")) {
            const status = (s.includes("'EXTERNA_FIXA'") ? "EXTERNA_FIXA" : p[3]) as StatusAlocacao;
            const linha = this.inserirAlocacao(Number(p[0]), Number(p[1]), String(p[2]), status);
            return [{ id: linha.id, data_geracao: linha.data, atualizado_em: linha.data }];
        }
        if (s.startsWith("UPDATE alocacao")) {
            const a = this.alocacoes.find((x) => x.id === Number(p[3]));
            if (!a) return [];
            a.salaId = Number(p[0]);
            a.horario = String(p[1]);
            if (p[2] != null) a.status = p[2] as StatusAlocacao;
            return [{}];
        }
        if (s.startsWith("DELETE FROM alocacao WHERE id = $1")) {
            const removidas = this.alocacoes.filter((a) => a.id === Number(p[0]));
            for (const r of removidas) this.alocacoes.splice(this.alocacoes.indexOf(r), 1);
            return removidas.map(() => ({}));
        }
        if (s.startsWith("DELETE FROM alocacao WHERE id_turma = $1")) {
            const removidas = this.alocacoes.filter((a) => a.turmaId === Number(p[0]));
            for (const r of removidas) this.alocacoes.splice(this.alocacoes.indexOf(r), 1);
            return removidas.map(() => ({}));
        }
        if (s.startsWith("DELETE FROM alocacao")) {
            const status = new Set(p[1] as string[]);
            const removidas = this.alocacoes.filter((a) => status.has(a.status) && this.#turma(a.turmaId).semestre === p[0]);
            for (const r of removidas) this.alocacoes.splice(this.alocacoes.indexOf(r), 1);
            return removidas.map(() => ({}));
        }
        throw new Error(`BancoFalso: SQL não suportado: ${s.slice(0, 120)}`);
    }

    #turma(id: number): Turma {
        const t = this.turmas.find((x) => x.id === id);
        if (!t) throw new Error(`violates foreign key constraint (turma ${id})`);
        return t;
    }

    #sala(id: number): Sala {
        const s = this.salas.find((x) => x.id === id);
        if (!s) throw new Error(`violates foreign key constraint (sala ${id})`);
        return s;
    }

    #linhaTurma(t: Turma): Record<string, unknown> {
        return {
            t_id: t.id, t_codigo: t.codigoTurma, t_semestre: t.semestre, t_cursos: t.cursosOfertados,
            t_vagas: t.vagas, t_matriculados: t.matriculados, t_requer_ic: t.requerAlocacaoIc, t_horario: t.horarioSigaa,
            t_aulas: t.aulasSemanais ?? null,
            d_codigo: t.disciplina.codigo, d_nome: t.disciplina.nome, d_ch: t.disciplina.cargaHoraria, d_lab: t.disciplina.exigeLaboratorio,
        };
    }

    #linhaAlocacao(a: LinhaAlocacao): Record<string, unknown> {
        const sala = this.#sala(a.salaId);
        return {
            a_id: a.id, a_horario: a.horario, a_status: a.status, a_data: a.data, a_atualizado: a.data,
            s_id: sala.id, s_nome: sala.nome, s_cap: sala.capacidade, s_tipo: sala.tipoEspaco, s_bloco: sala.bloco, s_alocavel: sala.alocavelIc,
            ...this.#linhaTurma(this.#turma(a.turmaId)),
        };
    }
}
