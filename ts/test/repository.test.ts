import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { formatarHorarioIndisponivel, parseHorarioIndisponivel } from "../src/db/repositories/professor.repository.ts";
import {
    DisciplinaRepository,
    ProfessorRepository,
    SalaRepository,
    TurmaRepository,
    AlocacaoRepository,
} from "../src/db/repositories/index.ts";
import type { QueryExecutor } from "../src/db/connection.ts";
import { diagnosticarViolacoes } from "../src/shared/validador.ts";
import type { Alocacao, Sala, Turma } from "../src/shared/tipos.ts";

interface RecordedQuery {
    sql: string;
    params?: unknown[];
}

function criarFakeExecutor(
    handler: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount?: number }
): { executor: QueryExecutor; queries: RecordedQuery[] } {
    const queries: RecordedQuery[] = [];
    const executor: QueryExecutor = {
        async query(sql: string, params?: unknown[]) {
            queries.push({ sql, params });
            const res = handler(sql, params);
            return {
                rows: res.rows,
                rowCount: res.rowCount ?? res.rows.length,
            } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        },
    };
    return { executor, queries };
}

describe("Repositórios e Mapeamentos do Banco", () => {
    test("parseHorarioIndisponivel suporta formato 'SEX-T-56' e 'SEX:T:56'", () => {
        const ind1 = parseHorarioIndisponivel("2024389", "SEX-T-56");
        assert.equal(ind1.diaSemana, "SEX");
        assert.equal(ind1.turno, "T");
        assert.equal(ind1.indiceHorario, "56");

        const ind2 = parseHorarioIndisponivel("2024389", "SEX:T:56");
        assert.equal(ind2.diaSemana, "SEX");
        assert.equal(ind2.turno, "T");
        assert.equal(ind2.indiceHorario, "56");
    });

    test("parseHorarioIndisponivel suporta formato SIGAA compacto '6T56'", () => {
        const ind = parseHorarioIndisponivel("2024389", "6T56");
        assert.equal(ind.diaSemana, "6");
        assert.equal(ind.turno, "T");
        assert.equal(ind.indiceHorario, "56");
    });

    test("formatarHorarioIndisponivel gera representação 'DIA-TURNO-HORAS'", () => {
        const str = formatarHorarioIndisponivel({
            professorMatricula: "2024389",
            diaSemana: "SEX",
            turno: "T",
            indiceHorario: "56",
        });
        assert.equal(str, "SEX-T-56");
    });

    test("instanciação de todos os repositórios sem erros", () => {
        assert.ok(new DisciplinaRepository());
        assert.ok(new ProfessorRepository());
        assert.ok(new SalaRepository());
        assert.ok(new TurmaRepository());
        assert.ok(new AlocacaoRepository());
    });

    test("AlocacaoRepository hidrata professores e indisponibilidades, habilitando detecção de RN-01", async () => {
        const { executor } = criarFakeExecutor((sql) => {
            if (sql.includes("FROM alocacao a")) {
                return {
                    rows: [
                        {
                            a_id: 1,
                            a_horario: "35T12",
                            a_status: "DEFINITIVA",
                            a_data: new Date("2026-11-22T12:00:00.000Z"),
                            s_id: 1,
                            s_nome: "Sala 02 IC",
                            s_cap: 60,
                            s_tipo: "Sala",
                            s_bloco: "IC",
                            s_alocavel: true,
                            t_id: 10,
                            t_codigo: "01",
                            t_semestre: "2026.2",
                            t_cursos: "CC",
                            t_vagas: 40,
                            t_matriculados: 35,
                            t_requer_ic: true,
                            t_horario: "35T12",
                            d_codigo: "COMP370",
                            d_nome: "PROBABILIDADE E ESTATÍSTICA",
                            d_ch: 72,
                            d_lab: false,
                        },
                    ],
                };
            }
            if (sql.includes("FROM professor_turma pt")) {
                return {
                    rows: [
                        {
                            id_turma: 10,
                            matricula_siape: "2024389",
                            nome_docente: "RANILSON OSCAR ARAUJO PAIVA",
                            carga_horaria_professor: 72,
                            horario_indisponivel: "SEX-T-56",
                        },
                    ],
                };
            }
            return { rows: [] };
        });

        const repo = new AlocacaoRepository();
        const alocacoes = await repo.listarPorSemestre("2026.2", executor);

        assert.equal(alocacoes.length, 1);
        assert.equal(alocacoes[0].turma.professores.length, 1);
        assert.equal(alocacoes[0].turma.professores[0].matriculaSiape, "2024389");
        assert.equal(alocacoes[0].turma.professores[0].indisponibilidades.length, 1);
        assert.equal(alocacoes[0].turma.cargaHorariaPorDocente["2024389"], 72);

        // Confirma que outra turma com o mesmo docente no mesmo horário dispara RN-01
        const outraTurma: Turma = {
            id: 20,
            disciplina: { codigo: "COMP399", nome: "TESTE", cargaHoraria: 60, exigeLaboratorio: false },
            professores: [{ matriculaSiape: "2024389", nome: "RANILSON OSCAR ARAUJO PAIVA", indisponibilidades: [] }],
            cargaHorariaPorDocente: { "2024389": 60 },
            codigoTurma: "01",
            semestre: "2026.2",
            cursosOfertados: "CC",
            horarioSigaa: "35T12",
            vagas: 30,
            matriculados: 30,
            requerAlocacaoIc: true,
        };
        const outraSala: Sala = {
            id: 2,
            nome: "Sala 03 IC",
            capacidade: 55,
            tipoEspaco: "Sala",
            bloco: "IC",
            alocavelIc: true,
        };

        const violacoes = diagnosticarViolacoes(outraTurma, outraSala, alocacoes, "35T12");
        assert.ok(violacoes.some((v) => v.regra === "RN-01"), "RN-01 deve disparar com professores hidratados");
    });

    test("AlocacaoRepository.limparPorSemestre preserva EXTERNA_FIXA por padrão", async () => {
        const { executor, queries } = criarFakeExecutor(() => ({ rows: [], rowCount: 5 }));
        const repo = new AlocacaoRepository();

        const removidas = await repo.limparPorSemestre("2026.2", false, executor);
        assert.equal(removidas, 5);
        assert.match(queries[0].sql, /status <> 'EXTERNA_FIXA'/);

        await repo.limparPorSemestre("2026.2", true, executor);
        assert.doesNotMatch(queries[1].sql, /status <> 'EXTERNA_FIXA'/);
    });

    test("AlocacaoRepository.substituirPorSemestre executa lock, limpeza seletiva e inserts no mesmo executor", async () => {
        let proximoId = 100;
        const { executor, queries } = criarFakeExecutor((sql) => {
            if (sql.includes("INSERT INTO alocacao")) {
                return {
                    rows: [{ id: proximoId++, data_geracao: new Date("2026-11-22T18:00:00.000Z") }],
                };
            }
            return { rows: [], rowCount: 1 };
        });

        const turma: Turma = {
            id: 10,
            disciplina: { codigo: "COMP360", nome: "LOGICA", cargaHoraria: 72, exigeLaboratorio: false },
            professores: [],
            cargaHorariaPorDocente: {},
            codigoTurma: "01",
            semestre: "2026.2",
            cursosOfertados: "CC",
            horarioSigaa: "24M34",
            vagas: 45,
            matriculados: 42,
            requerAlocacaoIc: true,
        };
        const sala: Sala = {
            id: 1,
            nome: "Sala 02 IC",
            capacidade: 60,
            tipoEspaco: "Sala",
            bloco: "IC",
            alocavelIc: true,
        };
        const aloc: Alocacao = { turma, sala, horarioCodigo: "24M34", status: "RASCUNHO" };

        const repo = new AlocacaoRepository();
        await repo.substituirPorSemestre("2026.2", [aloc], executor);

        assert.equal(queries.length, 3);
        assert.match(queries[0].sql, /pg_advisory_xact_lock/);
        assert.match(queries[1].sql, /DELETE FROM alocacao[\s\S]*status <> 'EXTERNA_FIXA'/);
        assert.match(queries[2].sql, /INSERT INTO alocacao/);
        assert.equal(aloc.id, 100);
        assert.equal(aloc.dataGeracao, "2026-11-22T18:00:00.000Z");
    });

    test("AlocacaoRepository.upsertExternaFixa atualiza quando já existe e insere quando não existe", async () => {
        const turma: Turma = {
            id: 77,
            disciplina: { codigo: "IF0001", nome: "FÍSICA 1", cargaHoraria: 72, exigeLaboratorio: false },
            professores: [],
            cargaHorariaPorDocente: {},
            codigoTurma: "05",
            semestre: "2026.2",
            cursosOfertados: "EC",
            horarioSigaa: "24T12",
            vagas: 50,
            matriculados: 37,
            requerAlocacaoIc: false,
        };
        const sala: Sala = {
            id: 13,
            nome: "Sala 207 BL12",
            capacidade: 54,
            tipoEspaco: "Sala",
            bloco: "BL12",
            alocavelIc: true,
        };

        const repo = new AlocacaoRepository();

        // Caso 1: ainda não existe -> INSERT
        const fakeInsert = criarFakeExecutor((sql) => {
            if (sql.includes("SELECT id, data_geracao")) return { rows: [] };
            if (sql.includes("INSERT INTO alocacao")) {
                return { rows: [{ id: 501, data_geracao: new Date("2026-11-22T19:00:00.000Z") }] };
            }
            return { rows: [] };
        });
        const inserida = await repo.upsertExternaFixa(
            { turma, sala, horarioCodigo: "24T12", status: "EXTERNA_FIXA" },
            fakeInsert.executor
        );
        assert.equal(inserida.id, 501);
        assert.equal(inserida.status, "EXTERNA_FIXA");
        assert.ok(fakeInsert.queries.some((q) => q.sql.includes("INSERT INTO alocacao")));

        // Caso 2: já existe -> UPDATE (idempotente)
        const fakeUpdate = criarFakeExecutor((sql) => {
            if (sql.includes("SELECT id, data_geracao")) {
                return { rows: [{ id: 501, data_geracao: new Date("2026-11-22T19:00:00.000Z") }] };
            }
            return { rows: [], rowCount: 1 };
        });
        const atualizada = await repo.upsertExternaFixa(
            { turma, sala, horarioCodigo: "24T12", status: "EXTERNA_FIXA" },
            fakeUpdate.executor
        );
        assert.equal(atualizada.id, 501);
        assert.ok(fakeUpdate.queries.some((q) => q.sql.includes("UPDATE alocacao")));
        assert.ok(!fakeUpdate.queries.some((q) => q.sql.includes("INSERT INTO alocacao")));
    });
});
