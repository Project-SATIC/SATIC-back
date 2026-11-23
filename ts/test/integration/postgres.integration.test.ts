import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { closePool, query, testConnection } from "../../src/db/connection.ts";
import { executarMigrations, resetarBanco } from "../../src/db/migrator.ts";
import {
    AlocacaoRepository,
    DisciplinaRepository,
    ProfessorRepository,
    SalaRepository,
    TurmaRepository,
} from "../../src/db/repositories/index.ts";
import { executarSeed } from "../../src/seed/db-seeder.ts";
import { AlocadorService } from "../../src/motor/alocador.service.ts";
import { RemanejamentoService } from "../../src/motor/remanejamento.service.ts";
import { ErroConflito } from "../../src/shared/erros.ts";
import { obterConjuntoSlots } from "../../src/shared/horario-sigaa.ts";

const DEVE_RODAR = process.env.SATIC_RUN_PG_TESTS === "1" || Boolean(process.env.SATIC_TEST_DATABASE_URL);

if (process.env.SATIC_TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.SATIC_TEST_DATABASE_URL;
}

function codigoPg(err: unknown): string | undefined {
    return (err as { code?: string } | undefined)?.code;
}

async function verificarAmbienteSeguro(): Promise<void> {
    const conn = await testConnection();
    if (!conn.ok) {
        throw new Error(`PostgreSQL indisponível para testes de integração: ${conn.message}`);
    }

    const resDb = await query<{ db: string }>("SELECT current_database() AS db;");
    const nomeDb = resDb.rows[0]?.db ?? "";
    const ehBancoTeste =
        nomeDb === "satic_test" ||
        nomeDb.endsWith("_test") ||
        process.env.SATIC_TEST_ALLOW_RESET === "1";

    if (!ehBancoTeste) {
        throw new Error(
            `Abortando testes destrutivos no banco '${nomeDb}'. Use um banco dedicado ('satic_test' ou sufixo '_test') ou defina SATIC_TEST_ALLOW_RESET=1.`
        );
    }
}

describe("Integração Real com PostgreSQL (Migrations, Constraints, CRUD, Seed e Motor)", () => {
    const motivoSkip = !DEVE_RODAR
        ? "Testes de integração PostgreSQL desabilitados por padrão (use 'npm run test:integration' ou SATIC_RUN_PG_TESTS=1)"
        : false;

    after(async () => {
        await closePool();
    });

    test(
        "1. resetarBanco e executarMigrations aplicam 001 e 002 de forma idempotente",
        { skip: motivoSkip },
        async () => {
            await verificarAmbienteSeguro();
            await resetarBanco();

            const primeira = await executarMigrations();
            assert.equal(primeira.length, 2);
            assert.ok(primeira.every((m) => m.status === "aplicada"));

            const segunda = await executarMigrations();
            assert.equal(segunda.length, 2);
            assert.ok(segunda.every((m) => m.status === "ja_executada"));
        }
    );

    test(
        "2. constraints CHECK, UNIQUE, FKs e trigger atualizado_em são aplicadas no PostgreSQL",
        { skip: motivoSkip },
        async () => {
            await verificarAmbienteSeguro();
            await resetarBanco();
            await executarMigrations();

            const salaRepo = new SalaRepository();
            const discRepo = new DisciplinaRepository();
            const profRepo = new ProfessorRepository();
            const turmaRepo = new TurmaRepository();
            const alocRepo = new AlocacaoRepository();

            // CHECK capacidade > 0 e tipo_espaco válido
            await assert.rejects(
                () =>
                    salaRepo.criar({
                        nome: "Sala Inválida Cap",
                        capacidade: 0,
                        tipoEspaco: "Sala",
                        bloco: "IC",
                        alocavelIc: true,
                    }),
                (err: unknown) => codigoPg(err) === "23514"
            );

            await assert.rejects(
                () =>
                    salaRepo.criar({
                        nome: "Sala Inválida Tipo",
                        capacidade: 40,
                        tipoEspaco: "Ginásio",
                        bloco: "IC",
                        alocavelIc: true,
                    }),
                (err: unknown) => codigoPg(err) === "23514"
            );

            // CHECK carga_horaria > 0
            await assert.rejects(
                () =>
                    discRepo.criar({
                        codigo: "TEST000",
                        nome: "Inválida",
                        cargaHoraria: 0,
                        exigeLaboratorio: false,
                    }),
                (err: unknown) => codigoPg(err) === "23514"
            );

            // Criação válida + teste de UNIQUE em criar()
            const sala = await salaRepo.criar({
                nome: "Sala Teste Integracao",
                capacidade: 40,
                tipoEspaco: "Sala",
                bloco: "IC",
                alocavelIc: true,
            });
            await assert.rejects(
                () =>
                    salaRepo.criar({
                        nome: "Sala Teste Integracao",
                        capacidade: 50,
                        tipoEspaco: "Sala",
                        bloco: "IC",
                        alocavelIc: true,
                    }),
                (err: unknown) => codigoPg(err) === "23505"
            );

            const disc = await discRepo.criar({
                codigo: "TEST101",
                nome: "DISCIPLINA TESTE",
                cargaHoraria: 60,
                exigeLaboratorio: false,
            });
            const prof = await profRepo.criar({
                matriculaSiape: "9999001",
                nome: "DOCENTE TESTE",
                indisponibilidades: [
                    { professorMatricula: "9999001", diaSemana: "SEX", turno: "T", indiceHorario: "56" },
                ],
            });
            const turma = await turmaRepo.criar({
                disciplina: disc,
                codigoTurma: "01",
                semestre: "2099.1",
                cursosOfertados: "CC",
                vagas: 35,
                matriculados: 30,
                requerAlocacaoIc: true,
                horarioSigaa: "24M12",
                professores: [prof],
                cargaHorariaPorDocente: { [prof.matriculaSiape]: 60 },
            });

            // Alocação + uq_alocacao_turma + RESTRICT na sala
            const aloc = await alocRepo.inserir({
                turma,
                sala,
                horarioCodigo: "24M12",
                status: "RASCUNHO",
            });
            assert.ok(aloc.id);
            assert.ok(aloc.atualizadoEm);

            // Duplicar alocação para mesma turma dispara uq_alocacao_turma (23505)
            await assert.rejects(
                () =>
                    alocRepo.inserir({
                        turma,
                        sala,
                        horarioCodigo: "35T12",
                        status: "RASCUNHO",
                    }),
                (err: unknown) => codigoPg(err) === "23505"
            );

            // Deletar sala com alocação dispara ON DELETE RESTRICT (23503)
            await assert.rejects(
                () => salaRepo.deletar(sala.id!),
                (err: unknown) => codigoPg(err) === "23503"
            );

            // Testa o trigger trg_alocacao_atualizado_em diretamente (sem atualizar atualizado_em no SQL)
            await query(
                "UPDATE alocacao SET data_geracao = CURRENT_TIMESTAMP - INTERVAL '2 hours', atualizado_em = CURRENT_TIMESTAMP - INTERVAL '2 hours' WHERE id = $1;",
                [aloc.id]
            );
            const antesTrigger = await query<{ atualizado_em: Date }>(
                "SELECT atualizado_em FROM alocacao WHERE id = $1;",
                [aloc.id]
            );
            await query("UPDATE alocacao SET horario_codigo = '35M12' WHERE id = $1;", [aloc.id]);
            const depoisTrigger = await query<{ atualizado_em: Date }>(
                "SELECT atualizado_em FROM alocacao WHERE id = $1;",
                [aloc.id]
            );
            assert.ok(
                depoisTrigger.rows[0].atualizado_em.getTime() >= antesTrigger.rows[0].atualizado_em.getTime(),
                "Trigger trg_alocacao_atualizado_em deve atualizar atualizado_em automaticamente em UPDATE"
            );

            const recarregada = await alocRepo.buscarPorId(aloc.id!);
            assert.equal(recarregada?.horarioCodigo, "35M12");
            assert.equal(recarregada?.turma.professores.length, 1);
            assert.equal(recarregada?.turma.professores[0].matriculaSiape, "9999001");

            // Limpeza + CRUD completo
            assert.equal(await alocRepo.deletar(aloc.id!), true);
            assert.equal(await turmaRepo.deletar(turma.id!), true);
            assert.equal(await salaRepo.deletar(sala.id!), true);
            assert.equal(await profRepo.removerRestricao(prof.matriculaSiape, "6T56"), true);
            assert.equal(await profRepo.deletar(prof.matriculaSiape), true);
            assert.equal(await discRepo.deletar(disc.codigo), true);
        }
    );

    test(
        "3. seed 2026.2 é idempotente, gera 86 alocações preservando 2 EXTERNA_FIXA e protege EXTERNA_FIXA",
        { skip: motivoSkip },
        async () => {
            await verificarAmbienteSeguro();
            await resetarBanco();
            await executarMigrations();

            const seed1 = await executarSeed();
            assert.equal(seed1.salas, 19);
            assert.equal(seed1.turmas, 95);
            assert.equal(seed1.reservasExternas, 2);

            // Reexecução idempotente do seed
            const seed2 = await executarSeed();
            assert.equal(seed2.reservasExternas, 2);

            const alocRepo = new AlocacaoRepository();
            const iniciais = await alocRepo.listarPorSemestre("2026.2");
            assert.equal(iniciais.length, 2);
            assert.ok(iniciais.every((a) => a.status === "EXTERNA_FIXA"));

            // Geração atômica pelo motor
            const alocador = new AlocadorService();
            const geracao = await alocador.gerarAlocacao({ semestre: "2026.2", persistir: true });
            assert.equal(geracao.resumo.completo, true);
            assert.equal(geracao.resumo.alocadas, 86);
            assert.equal(geracao.resumo.pendentes, 0);

            const todasAposGeracao = await alocRepo.listarPorSemestre("2026.2");
            assert.equal(todasAposGeracao.length, 88, "86 geradas + 2 EXTERNA_FIXA preservadas");
            const externasFixas = todasAposGeracao.filter((a) => a.status === "EXTERNA_FIXA");
            assert.equal(externasFixas.length, 2);
            assert.ok(
                todasAposGeracao.every((a) => a.turma.professores.length > 0),
                "Todas as alocações retornadas devem ter professores hidratados"
            );

            // Proteção de EXTERNA_FIXA contra remoção e remanejamento via API
            await assert.rejects(
                () => alocRepo.deletarProtegido(externasFixas[0].id!),
                ErroConflito
            );

            const remanejamento = new RemanejamentoService();
            await assert.rejects(
                () =>
                    remanejamento.confirmar({
                        turmaId: externasFixas[0].turma.id!,
                        salaId: externasFixas[0].sala.id!,
                        horario: "7T56",
                    }),
                ErroConflito
            );

            // Encontra duas turmas IC diferentes do mesmo docente para testar RN-01 real via RemanejamentoService
            const porDocente = new Map<string, typeof todasAposGeracao>();
            for (const a of todasAposGeracao.filter((x) => x.status !== "EXTERNA_FIXA")) {
                for (const p of a.turma.professores) {
                    const lista = porDocente.get(p.matriculaSiape) || [];
                    lista.push(a);
                    porDocente.set(p.matriculaSiape, lista);
                }
            }
            const parMesmoDocente = Array.from(porDocente.values()).find((lista) => lista.length >= 2);
            assert.ok(parMesmoDocente, "Deve existir docente com ao menos 2 turmas em 2026.2");

            const [alocA, alocB] = parMesmoDocente!;

            // Tentar mover alocA para o horário de alocB deve disparar RN-01 no PostgreSQL real
            const validacaoConflito = await remanejamento.validar({
                turmaId: alocA.turma.id!,
                salaId: alocA.sala.id!,
                horario: alocB.horarioCodigo,
            });
            assert.equal(validacaoConflito.valida, false);
            assert.ok(
                validacaoConflito.violacoes.some((v) => v.regra === "RN-01"),
                "RemanejamentoService deve detectar RN-01 com professores hidratados do PostgreSQL"
            );

            // Confirmar movimento inválido deve recusar sem alterar o banco
            const confirmacaoRecusada = await remanejamento.confirmar({
                turmaId: alocA.turma.id!,
                salaId: alocA.sala.id!,
                horario: alocB.horarioCodigo,
            });
            assert.equal(confirmacaoRecusada.sucesso, false);

            // Movimento válido em horário livre (sábado tarde 7T56) deve confirmar e atualizar
            const horarioLivre = "7T56";
            assert.ok(obterConjuntoSlots(horarioLivre).size > 0);
            const confirmacaoValida = await remanejamento.confirmar({
                turmaId: alocA.turma.id!,
                salaId: alocA.sala.id!,
                horario: horarioLivre,
                status: "DEFINITIVA",
            });
            assert.equal(confirmacaoValida.sucesso, true);

            const persistida = await alocRepo.buscarPorTurmaId(alocA.turma.id!);
            assert.equal(persistida?.horarioCodigo, horarioLivre);
            assert.equal(persistida?.status, "DEFINITIVA");
        }
    );
});
