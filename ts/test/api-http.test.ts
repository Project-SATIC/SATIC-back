/**
 * API por HTTP real (servidor em porta efêmera + fetch), com os serviços de alocação
 * ligados ao BancoFalso. Cobre o que o simulador de requisição não passa: parser de JSON,
 * códigos de status do handler global e o contrato de erro `{ erro, detalhes? }`.
 */
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { criarApp } from "../src/api/app.ts";
import { AlocacaoRepository, SalaRepository, TurmaRepository } from "../src/db/repositories/index.ts";
import { AlocadorService } from "../src/motor/alocador.service.ts";
import { RemanejamentoService } from "../src/motor/remanejamento.service.ts";
import { carregarBase2026_2 } from "../src/seed/seeder.ts";
import { chaveTurma } from "../src/shared/tipos.ts";
import { BancoFalso } from "./banco-falso.ts";

describe("API HTTP - validação de entrada e contrato de erros", () => {
    const banco = BancoFalso.daBase(carregarBase2026_2());
    const repos = [new TurmaRepository(), new SalaRepository(), new AlocacaoRepository()] as const;
    const app = criarApp({
        alocacoes: {
            alocacaoRepo: { listarPorSemestre: (s: string) => repos[2].listarPorSemestre(s, banco), listarTodas: () => repos[2].listarTodas(banco) },
            alocador: new AlocadorService(...repos, (fn) => fn(banco), banco),
            remanejamento: new RemanejamentoService(...repos, (fn) => fn(banco), banco),
        },
    });
    let server: Server;
    let base = "";

    before(async () => {
        await new Promise<void>((resolve) => {
            server = app.listen(0, "127.0.0.1", () => resolve());
        });
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    after(() => new Promise<void>((resolve) => server.close(() => resolve())));

    async function post(caminho: string, corpo: unknown, cru = false) {
        const res = await fetch(base + caminho, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: cru ? String(corpo) : JSON.stringify(corpo),
        });
        return { status: res.status, body: await res.json() };
    }

    const turmaId = (chave: string) => banco.turmas.find((t) => chaveTurma(t) === chave)!.id!;
    const salaId = (nome: string) => banco.salas.find((s) => s.nome === nome)!.id!;

    test("JSON malformado responde 400, não 500", async () => {
        const r = await post("/api/alocacoes/validar", "{ turmaId: ", true);
        assert.equal(r.status, 400);
        assert.equal(r.body.erro, "Corpo da requisição inválido");
    });

    test("corpo que não é objeto responde 400", async () => {
        const r = await post("/api/alocacoes/validar", [1, 2]);
        assert.equal(r.status, 400);
    });

    for (const [descricao, corpo, trecho] of [
        ["turmaId ausente", { salaId: 1 }, "turmaId"],
        ["turmaId não numérico", { turmaId: "abc", salaId: 1 }, "turmaId"],
        ["turmaId fracionário", { turmaId: 1.5, salaId: 1 }, "turmaId"],
        ["salaId negativo", { turmaId: 1, salaId: -3 }, "salaId"],
        ["horário fora do padrão SIGAA", { turmaId: 1, salaId: 1, horario: "segunda 8h" }, "horario inválido"],
        ["horário com dia inexistente", { turmaId: 1, salaId: 1, horario: "8M12" }, "horario inválido"],
    ] as const) {
        test(`/validar: ${descricao} responde 400`, async () => {
            const r = await post("/api/alocacoes/validar", corpo);
            assert.equal(r.status, 400);
            assert.ok(String(r.body.erro).includes(trecho), r.body.erro);
        });
    }

    test("/confirmar: status desconhecido responde 400 e não grava", async () => {
        const antes = banco.alocacoes.length;
        const r = await post("/api/alocacoes/confirmar", { turmaId: turmaId("COMP360-01"), salaId: salaId("LCCV"), status: "APROVADA" });
        assert.equal(r.status, 400);
        assert.match(r.body.erro, /status inválido/);
        assert.equal(banco.alocacoes.length, antes);
    });

    test("turma ou sala inexistente responde 404", async () => {
        assert.equal((await post("/api/alocacoes/validar", { turmaId: 99999, salaId: 1 })).status, 404);
        assert.equal((await post("/api/alocacoes/validar", { turmaId: turmaId("COMP360-01"), salaId: 99999 })).status, 404);
    });

    test("ids como string numérica são aceitos (vindos de data-attributes do front)", async () => {
        const r = await post("/api/alocacoes/validar", { turmaId: String(turmaId("COMP360-01")), salaId: String(salaId("LCCV")) });
        assert.equal(r.status, 200);
        assert.equal(r.body.horario, "24M34");
    });

    test("horário é normalizado (minúsculas e espaços extras)", async () => {
        const r = await post("/api/alocacoes/validar", { turmaId: turmaId("COMP360-01"), salaId: salaId("LCCV"), horario: "  24m34 " });
        assert.equal(r.status, 200);
        assert.equal(r.body.horario, "24M34");
    });

    test("/gerar valida semestre, limiteNos, semSalas e persistir", async () => {
        assert.equal((await post("/api/alocacoes/gerar", { semestre: "2026-2" })).status, 400);
        assert.equal((await post("/api/alocacoes/gerar", { limiteNos: 0 })).status, 400);
        assert.equal((await post("/api/alocacoes/gerar", { limiteNos: 1e12 })).status, 400);
        assert.equal((await post("/api/alocacoes/gerar", { semSalas: "Sala 02 IC" })).status, 400);
        assert.equal((await post("/api/alocacoes/gerar", { persistir: "talvez" })).status, 400);
    });

    test("/gerar de semestre sem turmas responde 404", async () => {
        const r = await post("/api/alocacoes/gerar", { semestre: "2099.1", persistir: false });
        assert.equal(r.status, 404);
        assert.match(r.body.erro, /Nenhuma turma/);
    });

    test("/gerar em preview responde 200 com resumo, preservadas e horariosInvalidos", async () => {
        const r = await post("/api/alocacoes/gerar", { persistir: false });
        assert.equal(r.status, 200);
        assert.equal(r.body.resumo.alocadas, 86);
        assert.equal(r.body.resumo.preservadas, 2);
        assert.equal(r.body.preservadas.length, 2);
        assert.deepEqual(r.body.horariosInvalidos, []);
    });

    test("fluxo do front: gerar -> validar (inválido) -> confirmar 409 -> confirmar 200", async () => {
        assert.equal((await post("/api/alocacoes/gerar", {})).status, 200);
        const t = turmaId("COMP360-01");

        // Sala 01 - IM tem 30 lugares: RN-03 para uma turma maior
        const invalido = await post("/api/alocacoes/validar", { turmaId: t, salaId: salaId("Sala 01 - IM") });
        assert.equal(invalido.status, 200);
        assert.equal(invalido.body.valida, false);

        const recusado = await post("/api/alocacoes/confirmar", { turmaId: t, salaId: salaId("Sala 01 - IM") });
        assert.equal(recusado.status, 409);
        assert.ok(recusado.body.violacoes.length > 0);

        const aceito = await post("/api/alocacoes/confirmar", { turmaId: t, salaId: salaId("LCCV") });
        assert.equal(aceito.status, 200);
        assert.equal(aceito.body.alocacao.sala.nome, "LCCV");
        assert.equal(aceito.body.alocacao.status, "DEFINITIVA");

        const lista = await (await fetch(`${base}/api/alocacoes?semestre=2026.2`)).json();
        assert.equal(lista.find((a: { turma: { id: number } }) => a.turma.id === t).sala.nome, "LCCV");
    });

    test("GET /api/alocacoes com semestre malformado ou repetido responde 400", async () => {
        assert.equal((await fetch(`${base}/api/alocacoes?semestre=abc`)).status, 400);
        assert.equal((await fetch(`${base}/api/alocacoes?semestre=2026.2&semestre=2026.1`)).status, 400);
        assert.equal((await fetch(`${base}/api/turmas?semestre=2026.2&semestre=2026.1`)).status, 400);
        assert.equal((await fetch(`${base}/api/salas?bloco=IC&bloco=IM`)).status, 400);
    });

    test("GET /api/salas/abc, /api/turmas/0 e ids > INT4 respondem 400 antes de consultar o banco", async () => {
        assert.equal((await fetch(`${base}/api/salas/abc`)).status, 400);
        assert.equal((await fetch(`${base}/api/turmas/0`)).status, 400);
        assert.equal((await fetch(`${base}/api/turmas/999999999999`)).status, 400);
        assert.equal((await fetch(`${base}/api/turmas?requer_ic=talvez`)).status, 400);
    });

    test("GET / inclui /shared/grade.js nas rotas documentadas", async () => {
        const res = await fetch(`${base}/`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.ok(body.documentacao.rotas.includes("/shared/grade.js"));
    });

    test("falha de conexão com o PostgreSQL vira 503 e violação de integridade (23505/23514) vira 409", async () => {
        const conexaoRecusada = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
        const duplicada = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
        const checkViolado = Object.assign(new Error("new row violates check constraint"), { code: "23514" });
        const appFalho = criarApp({
            alocacoes: {
                alocacaoRepo: {
                    listarTodas: async () => { throw new AggregateError([conexaoRecusada], ""); },
                    listarPorSemestre: async (s) => { throw (s === "2026.1" ? checkViolado : duplicada); },
                },
            },
        });
        const srv = await new Promise<Server>((resolve) => { const s = appFalho.listen(0, "127.0.0.1", () => resolve(s)); });
        const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/alocacoes`;
        try {
            const r1 = await fetch(url);
            assert.equal(r1.status, 503);
            assert.equal((await r1.json()).erro, "Banco de dados indisponível");
            const r2 = await fetch(url + "?semestre=2026.2");
            assert.equal(r2.status, 409);
            const r3 = await fetch(url + "?semestre=2026.1");
            assert.equal(r3.status, 409);
        } finally {
            await new Promise<void>((resolve) => srv.close(() => resolve()));
        }
    });

    test("CORS habilitado por padrão para o front local", async () => {
        const res = await fetch(`${base}/`, { headers: { origin: "http://127.0.0.1:8040" } });
        assert.equal(res.headers.get("access-control-allow-origin"), "*");
    });

    test("SEC-04: horário > 120 chars e limiteNos acima dos tetos respondem 400", async () => {
        const horarioLongo = "2M12 ".repeat(30).trim();
        const rH = await post("/api/alocacoes/validar", { turmaId: 1, salaId: 1, horario: horarioLongo });
        assert.equal(rH.status, 400);
        assert.match(rH.body.erro, /muito longo/);
        assert.equal((await post("/api/alocacoes/gerar", { limiteNos: 600_001 })).status, 400);
        assert.equal((await post("/api/alocacoes/sugestoes", { limiteNos: 400_001 })).status, 400);
    });

    test("SEC-05: NODE_ENV=production oculta detalhes internos em respostas 500 e 503", async () => {
        const conexaoRecusada = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
        const appFalho = criarApp({
            alocacoes: {
                alocacaoRepo: {
                    listarTodas: async () => { throw new AggregateError([conexaoRecusada], ""); },
                    listarPorSemestre: async () => { throw new Error("detalhe interno secreto do sql"); },
                },
            },
        });
        const srv = await new Promise<Server>((resolve) => { const s = appFalho.listen(0, "127.0.0.1", () => resolve(s)); });
        const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/alocacoes`;
        const envAnterior = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        try {
            const r503 = await fetch(url);
            assert.equal(r503.status, 503);
            const b503 = await r503.json();
            assert.equal(b503.detalhes, undefined);

            const r500 = await fetch(url + "?semestre=2026.2");
            assert.equal(r500.status, 500);
            const b500 = await r500.json();
            assert.equal(b500.detalhes, undefined);
        } finally {
            if (envAnterior === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = envAnterior;
            await new Promise<void>((resolve) => srv.close(() => resolve()));
        }
    });
});
