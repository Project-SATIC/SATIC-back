import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { criarApp } from "../src/api/app.ts";
import {
    AlocacaoRepository,
    AuditoriaRepository,
    SalaRepository,
    TurmaRepository,
     type RegistroAuditoria,
} from "../src/db/repositories/index.ts";
import {
    definirSinkLogs,
    limparLogsRecentes,
    normalizarAutor,
    normalizarRequestId,
    obterLogsRecentes,
    type EntradaLogEstruturado,
} from "../src/logger.ts";
import { AlocadorService } from "../src/motor/alocador.service.ts";
import { FilaMotorService } from "../src/motor/fila-motor.service.ts";
import { RemanejamentoService } from "../src/motor/remanejamento.service.ts";
import { SugestoesService } from "../src/motor/sugestoes.service.ts";
import { carregarBase2026_2 } from "../src/seed/seeder.ts";
import { BancoFalso } from "./banco-falso.ts";

describe("Observabilidade: Logger estruturado, X-Request-Id e X-Actor", () => {
    test("normalizarRequestId preserva IDs seguros e substitui malformados por UUID", () => {
        assert.equal(normalizarRequestId("req-123_ABC.45"), "req-123_ABC.45");
        assert.match(normalizarRequestId(""), /^[0-9a-f-]{36}$/i);
        assert.match(normalizarRequestId("invalido com espaco"), /^[0-9a-f-]{36}$/i);
        assert.match(normalizarRequestId("a".repeat(65)), /^[0-9a-f-]{36}$/i);
    });

    test("normalizarAutor higieniza quebras de linha, limita a 120 chars e aplica fallback", () => {
        assert.equal(normalizarAutor("  coord.dcc\n\t "), "coord.dcc");
        assert.equal(normalizarAutor("   "), "sistema");
        assert.equal(normalizarAutor(undefined), "sistema");
        assert.equal(normalizarAutor("x".repeat(150)).length, 120);
    });

    test("middlewareContextoELogs propaga X-Request-Id, X-Actor e emite log estruturado HTTP", async () => {
        const capturados: EntradaLogEstruturado[] = [];
        limparLogsRecentes();
        definirSinkLogs((e) => capturados.push(e));

        const app = criarApp({
            testConnection: async () => ({ ok: true, message: "ok" }),
        });
        const srv = await new Promise<Server>((resolve) => {
            const s = app.listen(0, "127.0.0.1", () => resolve(s));
        });
        const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;

        try {
            const res = await fetch(`${base}/api/health`, {
                headers: {
                    "X-Request-Id": "trace-satic-001",
                    "X-Actor": "secretaria.ic",
                },
            });
            assert.equal(res.status, 200);
            assert.equal(res.headers.get("x-request-id"), "trace-satic-001");

            // Aguarda evento 'finish' do response
            await new Promise((r) => setTimeout(r, 15));

            const logHttp = capturados.find(
                (l) => l.msg === "http_request" && l.requestId === "trace-satic-001",
            );
            assert.ok(logHttp, "deve ter emitido log estruturado http_request");
            assert.equal(logHttp.autor, "secretaria.ic");
            assert.equal(logHttp.method, "GET");
            assert.equal(logHttp.path, "/api/health");
            assert.equal(logHttp.status, 200);
            assert.equal(typeof logHttp.durationMs, "number");
            assert.ok(obterLogsRecentes(10).some((l) => l.requestId === "trace-satic-001"));
        } finally {
            definirSinkLogs(null);
            await new Promise<void>((resolve) => srv.close(() => resolve()));
        }
    });
});

describe("Mensageria Assíncrona: FilaMotorService e Worker Threads", () => {
    const banco = BancoFalso.daBase(carregarBase2026_2());
    const turmaRepo = new TurmaRepository();
    const salaRepo = new SalaRepository();
    const alocacaoRepo = new AlocacaoRepository();
    const transacaoFalsa = <T>(fn: (db: typeof banco) => Promise<T>) => fn(banco);

    const fila = new FilaMotorService(
        turmaRepo,
        salaRepo,
        alocacaoRepo,
        transacaoFalsa as never,
        banco,
        { concorrenciaMaxima: 2, maxPendentes: 5 },
    );

    const app = criarApp({
        alocacoes: {
            alocacaoRepo: {
                listarPorSemestre: (s: string) => alocacaoRepo.listarPorSemestre(s, banco),
                listarTodas: () => alocacaoRepo.listarTodas(banco),
            },
            alocador: new AlocadorService(turmaRepo, salaRepo, alocacaoRepo, transacaoFalsa as never, banco),
            remanejamento: new RemanejamentoService(turmaRepo, salaRepo, alocacaoRepo, transacaoFalsa as never, banco),
            sugestoes: new SugestoesService(turmaRepo, salaRepo, alocacaoRepo, banco),
            fila,
        },
    });

    let srv: Server;
    let base = "";

    before(async () => {
        srv = await new Promise<Server>((resolve) => {
            const s = app.listen(0, "127.0.0.1", () => resolve(s));
        });
        base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    });

    after(() => new Promise<void>((resolve) => srv.close(() => resolve())));

    test("POST /api/alocacoes/jobs/gerar executa StateSpaceSearch em Worker Thread e persiste grade", async () => {
        const res = await fetch(`${base}/api/alocacoes/jobs/gerar`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-actor": "coordenador.cc",
                "x-request-id": "req-job-gerar-1",
            },
            body: JSON.stringify({ semestre: "2026.2", persistir: true }),
        });
        assert.equal(res.status, 202);
        const jobInicial = await res.json();
        assert.ok(jobInicial.jobId);
        assert.equal(jobInicial.tipo, "gerar");
        assert.equal(jobInicial.autor, "coordenador.cc");
        assert.equal(jobInicial.requestId, "req-job-gerar-1");

        const jobFinal = await fila.aguardarJob(jobInicial.jobId);
        assert.ok(jobFinal);
        assert.equal(jobFinal.status, "CONCLUIDO");

        const consulta = await fetch(`${base}/api/alocacoes/jobs/${jobInicial.jobId}`);
        assert.equal(consulta.status, 200);
        const bodyConsulta = await consulta.json();
        assert.equal(bodyConsulta.status, "CONCLUIDO");
        assert.equal(bodyConsulta.resultado.resumo.alocadas, 86);
        assert.equal(bodyConsulta.resultado.resumo.preservadas, 2);
    });

    test("POST /api/alocacoes/sugestoes?async=true executa sugerirResolucoes em Worker Thread", async () => {
        const res = await fetch(`${base}/api/alocacoes/sugestoes?async=true`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ semestre: "2026.2" }),
        });
        assert.equal(res.status, 202);
        const jobInicial = await res.json();
        assert.equal(jobInicial.tipo, "sugestoes");

        const jobFinal = await fila.aguardarJob(jobInicial.jobId);
        assert.ok(jobFinal);
        assert.equal(jobFinal.status, "CONCLUIDO");

        const listaRes = await fetch(`${base}/api/alocacoes/jobs?semestre=2026.2&status=CONCLUIDO`);
        assert.equal(listaRes.status, 200);
        const lista = await listaRes.json();
        assert.ok(Array.isArray(lista) && lista.length >= 2);
    });

    test("Job com semestre inexistente registra status FALHOU sem derrubar o processo", async () => {
        const res = await fetch(`${base}/api/alocacoes/jobs/gerar`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ semestre: "2099.1", persistir: false }),
        });
        assert.equal(res.status, 202);
        const jobInicial = await res.json();

        const jobFinal = await fila.aguardarJob(jobInicial.jobId);
        assert.ok(jobFinal);
        assert.equal(jobFinal.status, "FALHOU");
        assert.match(String(jobFinal.erro), /Nenhuma turma encontrada/);

        assert.equal((await fetch(`${base}/api/alocacoes/jobs/inexistente`)).status, 404);
        assert.equal((await fetch(`${base}/api/alocacoes/jobs?status=INVALIDO`)).status, 400);
    });
});

describe("Auditoria Transacional (Migration 006 + PGlite) e Infra Docker", () => {
    let pglite: PGlite;
    let socket: PGLiteSocketServer;
    let srv: Server;
    let base = "";
    let closePoolFn: () => Promise<void>;

    before(async () => {
        pglite = await PGlite.create();
        socket = new PGLiteSocketServer({ db: pglite, port: 0, host: "127.0.0.1" });
        await socket.start();
        const hostPort = socket.getServerConn();
        const [host, port] = hostPort.split(":");
        process.env.PGHOST = host;
        process.env.PGPORT = port;
        process.env.PGUSER = "postgres";
        process.env.PGPASSWORD = "postgres";
        process.env.PGDATABASE = "postgres";
        process.env.PGPOOL_MAX = "1";
        delete process.env.DATABASE_URL;

        const conn = await import("../src/db/connection.ts");
        await conn.closePool();
        closePoolFn = conn.closePool;

        const migrator = await import("../src/db/migrator.ts");
        await migrator.resetarBanco();
        await migrator.executarMigrations();

        const app = criarApp();
        srv = await new Promise<Server>((resolve) => {
            const s = app.listen(0, "127.0.0.1", () => resolve(s));
        });
        base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    });

    after(async () => {
        if (srv) await new Promise<void>((resolve) => srv.close(() => resolve()));
        if (closePoolFn) await closePoolFn();
        if (socket) await socket.stop();
        if (pglite) await pglite.close();
    });

    test("triggers de auditoria gravam INSERT, UPDATE e DELETE com X-Actor, X-Request-Id e snapshots JSONB", async () => {
        // 1. Criar sala com X-Actor e X-Request-Id
        const criarRes = await fetch(`${base}/api/salas`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-actor": "chefe.ic",
                "x-request-id": "req-sala-create",
            },
            body: JSON.stringify({
                nome: "Lab Auditoria 01",
                capacidade: 40,
                tipoEspaco: "Laboratório",
                bloco: "IC",
                alocavelIc: true,
            }),
        });
        assert.equal(criarRes.status, 201);
        const salaCriada = await criarRes.json();

        // 2. Atualizar status da sala para Manutenção
        const patchRes = await fetch(`${base}/api/salas/${salaCriada.id}/status`, {
            method: "PATCH",
            headers: {
                "content-type": "application/json",
                "x-actor": "tecnico.labs",
                "x-request-id": "req-sala-patch",
            },
            body: JSON.stringify({ status: "Manutenção" }),
        });
        assert.equal(patchRes.status, 200);

        // 3. Remover sala
        const delRes = await fetch(`${base}/api/salas/${salaCriada.id}`, {
            method: "DELETE",
            headers: {
                "x-actor": "chefe.ic",
                "x-request-id": "req-sala-delete",
            },
        });
        assert.equal(delRes.status, 204);

        // 4. Consultar trilha de auditoria pela rota GET /api/auditoria
        const audRes = await fetch(`${base}/api/auditoria?entidade=sala&entidade_id=${salaCriada.id}`);
        assert.equal(audRes.status, 200);
        const registros = (await audRes.json()) as RegistroAuditoria[];
        assert.equal(registros.length, 3);

        const porOperacao = new Map(registros.map((r) => [r.operacao, r]));

        const regInsert = porOperacao.get("INSERT")!;
        assert.equal(regInsert.autor, "chefe.ic");
        assert.equal(regInsert.requestId, "req-sala-create");
        assert.equal(regInsert.dadosAnteriores, null);
        assert.equal(regInsert.dadosNovos?.nome, "Lab Auditoria 01");
        assert.equal(regInsert.dadosNovos?.status, "Disponível");

        const regUpdate = porOperacao.get("UPDATE")!;
        assert.equal(regUpdate.autor, "tecnico.labs");
        assert.equal(regUpdate.requestId, "req-sala-patch");
        assert.equal(regUpdate.dadosAnteriores?.status, "Disponível");
        assert.equal(regUpdate.dadosNovos?.status, "Manutenção");

        const regDelete = porOperacao.get("DELETE")!;
        assert.equal(regDelete.autor, "chefe.ic");
        assert.equal(regDelete.requestId, "req-sala-delete");
        assert.equal(regDelete.dadosAnteriores?.nome, "Lab Auditoria 01");
        assert.equal(regDelete.dadosNovos, null);

        // Consulta individual por ID
        const detalheRes = await fetch(`${base}/api/auditoria/${regUpdate.id}`);
        assert.equal(detalheRes.status, 200);
        assert.equal((await detalheRes.json()).id, regUpdate.id);

        // Validação de filtros e erros
        assert.equal((await fetch(`${base}/api/auditoria?operacao=INVALIDA`)).status, 400);
        assert.equal((await fetch(`${base}/api/auditoria?limite=9999`)).status, 400);
        assert.equal((await fetch(`${base}/api/auditoria/999999`)).status, 404);
    });

    test("AuditoriaRepository.registrar grava eventos de domínio customizados (ex: GERACAO_MOTOR)", async () => {
        const repo = new AuditoriaRepository();
        const ev = await repo.registrar({
            entidade: "semestre",
            entidadeId: "2026.2",
            operacao: "GERACAO_MOTOR",
            autor: "motor.automatico",
            requestId: "req-motor-99",
            dadosNovos: { alocadas: 86, pendentes: 0 },
        });
        assert.ok(ev.id > 0);
        assert.equal(ev.operacao, "GERACAO_MOTOR");
        assert.equal(ev.autor, "motor.automatico");
        assert.deepEqual(ev.dadosNovos, { alocadas: 86, pendentes: 0 });
    });

    test("comTransacao reentrante com PGPOOL_MAX=1 não trava e trigger trunca autor > 120 chars com segurança", async () => {
        const { comTransacao, query } = await import("../src/db/connection.ts");
        const { executarComContexto } = await import("../src/logger.ts");

        await executarComContexto(
            { requestId: "req-nested-tx", autor: "admin.reentrante", iniciadoEmMs: performance.now() },
            async () => {
                await comTransacao(async (db) => {
                    // Chamada direta a query() e a outra comTransacao() dentro de transação aberta num pool max=1
                    await query("INSERT INTO disciplina (codigo, nome, carga_horaria) VALUES ($1, $2, $3);", [
                        "AUD001",
                        "Auditoria Reentrante",
                        60,
                    ]);
                    await comTransacao(async () => {
                        await db.query("SELECT set_config('satic.autor', $1, true);", ["A".repeat(200)]);
                        await query("UPDATE disciplina SET nome = $1 WHERE codigo = $2;", [
                            "Auditoria Reentrante Editada",
                            "AUD001",
                        ]);
                    });
                });
            },
        );

        const logs = await new AuditoriaRepository().listar({ entidade: "disciplina", entidadeId: "AUD001" });
        assert.equal(logs.length, 2);
        const logUpdate = logs.find((l) => l.operacao === "UPDATE")!;
        assert.equal(logUpdate.autor.length, 120);
    });

    test("Arquivos de containerização (Dockerfile, .dockerignore e docker-compose.yml) estão presentes e válidos", () => {
        const raizTs = path.resolve(import.meta.dirname, "..");
        const raizRepo = path.resolve(raizTs, "..");

        const dockerfile = fs.readFileSync(path.join(raizTs, "Dockerfile"), "utf-8");
        assert.match(dockerfile, /FROM node:22-alpine/);
        assert.match(dockerfile, /USER node/);
        assert.match(dockerfile, /HEALTHCHECK/);

        const dockerignore = fs.readFileSync(path.join(raizTs, ".dockerignore"), "utf-8");
        assert.match(dockerignore, /node_modules/);
        assert.match(dockerignore, /\.pglite/);

        const compose = fs.readFileSync(path.join(raizRepo, "docker-compose.yml"), "utf-8");
        assert.match(compose, /postgres:16-alpine/);
        assert.match(compose, /service_healthy/);
        assert.match(compose, /AUTO_MIGRATE/);
    });
});
