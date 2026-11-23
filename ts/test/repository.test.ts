import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
    canonicalizarHorarioIndisponivel,
    formatarHorarioIndisponivel,
    parseHorarioIndisponivel,
} from "../src/db/repositories/professor.repository.ts";
import {
    DisciplinaRepository,
    ProfessorRepository,
    SalaRepository,
    TurmaRepository,
    AlocacaoRepository,
} from "../src/db/repositories/index.ts";
import {
    listarArquivosMigrations,
    MIGRATIONS_DIR,
    SQL_RESET_BANCO,
} from "../src/db/migrator.ts";
import { formatarErro, type QueryExecutor } from "../src/db/connection.ts";
import { ErroConflito, ErroValidacao } from "../src/shared/erros.ts";
import { slotsDaIndisponibilidade } from "../src/shared/horario-sigaa.ts";
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

    test("AlocacaoRepository.upsertExternaFixa executa UPSERT atômico por id_turma", async () => {
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
        const fake = criarFakeExecutor((sql) => {
            if (sql.includes("ON CONFLICT (id_turma) DO UPDATE")) {
                return {
                    rows: [
                        {
                            id: 501,
                            data_geracao: new Date("2026-11-22T19:00:00.000Z"),
                            atualizado_em: new Date("2026-11-22T19:30:00.000Z"),
                        },
                    ],
                };
            }
            return { rows: [] };
        });

        const resultado = await repo.upsertExternaFixa(
            { turma, sala, horarioCodigo: "24T12", status: "EXTERNA_FIXA" },
            fake.executor
        );
        assert.equal(fake.queries.length, 1);
        assert.equal(resultado.id, 501);
        assert.equal(resultado.status, "EXTERNA_FIXA");
        assert.equal(resultado.atualizadoEm, "2026-11-22T19:30:00.000Z");
    });

    test("canonicalizarHorarioIndisponivel, slotsDaIndisponibilidade multi-dia, semestre com trim, deletarProtegido e formatarErro", async () => {
        assert.equal(canonicalizarHorarioIndisponivel("6T56"), "SEX-T-56");
        assert.equal(canonicalizarHorarioIndisponivel("SEX-T-655"), "SEX-T-56");
        assert.equal(canonicalizarHorarioIndisponivel("INVALIDO"), null);

        // Multi-dia compacto '35T12' expande TER e QUI corretamente
        const indMulti = parseHorarioIndisponivel("123", "35T12");
        assert.deepEqual(slotsDaIndisponibilidade(indMulti), ["TER-T1", "TER-T2", "QUI-T1", "QUI-T2"]);

        // removerRestricao busca tanto formato compacto quanto canônico
        const profFake = criarFakeExecutor(() => ({ rows: [], rowCount: 1 }));
        const profRepo = new ProfessorRepository();
        assert.equal(await profRepo.removerRestricao("2024389", "6T56", profFake.executor), true);
        assert.ok((profFake.queries[0].params?.[1] as string[]).includes("6T56"));
        assert.ok((profFake.queries[0].params?.[1] as string[]).includes("SEX-T-56"));

        // AlocacaoRepository normaliza semestre e rejeita vazio
        const alocRepo = new AlocacaoRepository();
        const semFake = criarFakeExecutor(() => ({ rows: [] }));
        await alocRepo.listarPorSemestre(" 2026.2 ", semFake.executor);
        assert.deepEqual(semFake.queries[0].params, ["2026.2"]);
        await assert.rejects(() => alocRepo.listarPorSemestre("   ", semFake.executor), ErroValidacao);

        // TurmaRepository.listarPorSemestre rejeita vazio
        const turmaRepo = new TurmaRepository();
        await assert.rejects(() => turmaRepo.listarPorSemestre("   ", semFake.executor), ErroValidacao);

        // deletarProtegido recusa EXTERNA_FIXA com ErroConflito
        const delFake = criarFakeExecutor((sql) => {
            if (sql.includes("JOIN turma")) {
                return { rows: [{ status: "EXTERNA_FIXA", semestre: "2026.2" }] };
            }
            if (sql.includes("SELECT status FROM alocacao")) {
                return { rows: [{ status: "EXTERNA_FIXA" }] };
            }
            return { rows: [], rowCount: 1 };
        });
        await assert.rejects(() => alocRepo.deletarProtegido(1, delFake.executor), ErroConflito);

        // formatarErro extrai causas internas de AggregateError sem mensagem própria
        const agg = new AggregateError([new Error("ECONNREFUSED 127.0.0.1:5432")], "");
        assert.match(formatarErro(agg), /ECONNREFUSED/);
    });

    test("migrations ordenadas incluem 001 e 002 com constraints CHECK, UNIQUE(id_turma) e atualizado_em", async () => {
        const arquivos = await listarArquivosMigrations();
        assert.deepEqual(arquivos.slice(0, 2), [
            "001_criar_schema_inicial.sql",
            "002_restricoes_integridade_e_auditoria.sql",
        ]);

        const sql002 = await fs.readFile(
            path.join(MIGRATIONS_DIR, "002_restricoes_integridade_e_auditoria.sql"),
            "utf-8"
        );

        const trechosEsperados = [
            "ADD COLUMN IF NOT EXISTS atualizado_em",
            "atualizar_timestamp_alocacao",
            "trg_alocacao_atualizado_em",
            "chk_sala_capacidade_positiva",
            "chk_sala_tipo_espaco",
            "chk_disciplina_carga_horaria_positiva",
            "chk_turma_vagas_nao_negativas",
            "chk_turma_matriculados_nao_negativos",
            "chk_turma_horario_nao_vazio",
            "chk_professor_turma_carga_positiva",
            "chk_restricoes_horario_nao_vazio",
            "chk_alocacao_status_valido",
            "chk_alocacao_horario_nao_vazio",
            "uq_alocacao_turma",
            "DROP INDEX IF EXISTS idx_alocacao_turma",
        ];

        for (const trecho of trechosEsperados) {
            assert.ok(sql002.includes(trecho), `Migration 002 deve conter '${trecho}'`);
        }

        assert.match(SQL_RESET_BANCO, /pg_tables/);
        assert.match(SQL_RESET_BANCO, /pg_proc/);
        assert.match(SQL_RESET_BANCO, /pg_depend/);
    });

    test("SalaRepository suporta filtros em SQL, atualizar e deletar", async () => {
        const { executor, queries } = criarFakeExecutor((sql) => {
            if (sql.includes("FROM sala") && sql.includes("WHERE")) {
                return {
                    rows: [
                        {
                            id: 1,
                            nome: "Sala 02 IC",
                            capacidade: 60,
                            tipo_espaco: "Sala",
                            bloco: "IC",
                            alocavel_ic: true,
                        },
                    ],
                };
            }
            if (sql.includes("UPDATE sala")) {
                return {
                    rows: [
                        {
                            id: 1,
                            nome: "Sala 02 IC (Reformada)",
                            capacidade: 65,
                            tipo_espaco: "Sala",
                            bloco: "IC",
                            alocavel_ic: true,
                        },
                    ],
                };
            }
            return { rows: [], rowCount: 1 };
        });

        const repo = new SalaRepository();
        const filtradas = await repo.listar({ alocavelIc: true, bloco: "IC" }, executor);
        assert.equal(filtradas.length, 1);
        assert.match(queries[0].sql, /WHERE alocavel_ic = \$1 AND LOWER\(bloco\) = LOWER\(\$2\)/);
        assert.deepEqual(queries[0].params, [true, "IC"]);

        const atualizada = await repo.atualizar(1, { capacidade: 65 }, executor);
        assert.equal(atualizada?.capacidade, 65);
        assert.match(queries[1].sql, /UPDATE sala/);

        const removida = await repo.deletar(1, executor);
        assert.equal(removida, true);
        assert.match(queries[2].sql, /DELETE FROM sala WHERE id = \$1/);
    });

    test("DisciplinaRepository suporta atualizar e deletar", async () => {
        const { executor, queries } = criarFakeExecutor((sql) => {
            if (sql.includes("UPDATE disciplina")) {
                return {
                    rows: [
                        {
                            codigo: "COMP360",
                            nome: "PROGRAMAÇÃO 1",
                            carga_horaria: 72,
                            exige_laboratorio: true,
                        },
                    ],
                };
            }
            return { rows: [], rowCount: 1 };
        });

        const repo = new DisciplinaRepository();
        const atualizada = await repo.atualizar("COMP360", { cargaHoraria: 72 }, executor);
        assert.equal(atualizada?.cargaHoraria, 72);
        assert.match(queries[0].sql, /UPDATE disciplina/);

        const removida = await repo.deletar("COMP360", executor);
        assert.equal(removida, true);
        assert.match(queries[1].sql, /DELETE FROM disciplina WHERE codigo = \$1/);
    });

    test("ProfessorRepository suporta atualizar, deletar, removerRestricao e substituirRestricoes", async () => {
        const { executor, queries } = criarFakeExecutor((sql) => {
            if (sql.includes("UPDATE professor")) {
                return { rows: [{ matricula_siape: "2024389", nome: "RANILSON PAIVA" }] };
            }
            return { rows: [], rowCount: 1 };
        });

        const repo = new ProfessorRepository();

        const atualizado = await repo.atualizar(
            "2024389",
            {
                nome: "RANILSON PAIVA",
                indisponibilidades: [
                    { professorMatricula: "2024389", diaSemana: "SEX", turno: "T", indiceHorario: "56" },
                ],
            },
            executor
        );
        assert.equal(atualizado?.nome, "RANILSON PAIVA");
        assert.equal(atualizado?.indisponibilidades.length, 1);
        assert.ok(queries.some((q) => q.sql.includes("DELETE FROM restricoes_horario WHERE matricula_siape = $1")));
        assert.ok(queries.some((q) => q.sql.includes("INSERT INTO restricoes_horario")));

        const remRestricao = await repo.removerRestricao("2024389", "SEX-T-56", executor);
        assert.equal(remRestricao, true);

        const remProf = await repo.deletar("2024389", executor);
        assert.equal(remProf, true);
    });

    test("TurmaRepository suporta filtros em SQL, atualizar com docentes e deletar", async () => {
        const { executor, queries } = criarFakeExecutor((sql) => {
            if (sql.includes("UPDATE turma")) {
                return { rows: [{ id: 10, id_disciplina: "COMP360" }] };
            }
            if (sql.includes("SELECT carga_horaria FROM disciplina")) {
                return { rows: [{ carga_horaria: 72 }] };
            }
            if (sql.includes("FROM turma t")) {
                return {
                    rows: [
                        {
                            t_id: 10,
                            t_codigo: "01",
                            t_semestre: "2026.2",
                            t_cursos: "CC",
                            t_vagas: 50,
                            t_matriculados: 42,
                            t_requer_ic: true,
                            t_horario: "24M34",
                            d_codigo: "COMP360",
                            d_nome: "LÓGICA",
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
                            nome_docente: "RANILSON",
                            carga_horaria_professor: 72,
                            horario_indisponivel: null,
                        },
                    ],
                };
            }
            return { rows: [], rowCount: 1 };
        });

        const repo = new TurmaRepository();
        const filtradas = await repo.listar({ semestre: "2026.2", requerAlocacaoIc: true }, executor);
        assert.equal(filtradas.length, 1);
        assert.match(queries[0].sql, /WHERE t\.semestre = \$1 AND t\.requer_alocacao_ic = \$2/);

        const atualizada = await repo.atualizar(
            10,
            { vagas: 50, professores: [{ matriculaSiape: "2024389" }] },
            executor
        );
        assert.equal(atualizada?.vagas, 50);
        assert.equal(atualizada?.professores.length, 1);
        assert.ok(queries.some((q) => q.sql.includes("DELETE FROM professor_turma WHERE id_turma = $1")));

        const removida = await repo.deletar(10, executor);
        assert.equal(removida, true);
    });

    test("AlocacaoRepository suporta buscarPorId hidratado e deletar", async () => {
        const { executor, queries } = criarFakeExecutor((sql) => {
            if (sql.includes("FROM alocacao a") && sql.includes("WHERE a.id = $1")) {
                return {
                    rows: [
                        {
                            a_id: 42,
                            a_horario: "24M34",
                            a_status: "DEFINITIVA",
                            a_data: new Date("2026-11-22T12:00:00.000Z"),
                            a_atualizado: new Date("2026-11-22T12:30:00.000Z"),
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
                            t_vagas: 45,
                            t_matriculados: 42,
                            t_requer_ic: true,
                            t_horario: "24M34",
                            d_codigo: "COMP360",
                            d_nome: "LÓGICA",
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
                            nome_docente: "RANILSON",
                            carga_horaria_professor: 72,
                            horario_indisponivel: null,
                        },
                    ],
                };
            }
            return { rows: [], rowCount: 1 };
        });

        const repo = new AlocacaoRepository();
        const aloc = await repo.buscarPorId(42, executor);
        assert.equal(aloc?.id, 42);
        assert.equal(aloc?.atualizadoEm, "2026-11-22T12:30:00.000Z");
        assert.equal(aloc?.turma.professores.length, 1);

        const removida = await repo.deletar(42, executor);
        assert.equal(removida, true);
        assert.ok(queries.some((q) => q.sql.includes("DELETE FROM alocacao WHERE id = $1")));
    });
});
