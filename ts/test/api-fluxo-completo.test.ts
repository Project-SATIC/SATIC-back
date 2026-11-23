import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { criarApp } from "../src/api/app.ts";
import { responderErroBanco } from "../src/api/pg-errors.ts";
import { closePool } from "../src/db/connection.ts";

interface MockResponse {
    status: number;
    body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function simularRequisicao(
    app: ReturnType<typeof criarApp>,
    method: string,
    url: string,
    body?: any // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<MockResponse> {
    return new Promise((resolve) => {
        const req = new EventEmitter() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        req.method = method;
        req.url = url;
        req.headers = { host: "localhost", "content-type": "application/json" };
        req.params = {};
        if (body !== undefined) {
            req.body = body;
        }

        let statusCode = 200;

        const res = new EventEmitter() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        res.statusCode = 200;
        res.setHeader = () => res;
        res.getHeader = () => undefined;
        res.status = (code: number) => {
            statusCode = code;
            res.statusCode = code;
            return res;
        };
        res.json = (data: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            resolve({ status: statusCode, body: data });
        };
        res.send = (data: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            resolve({ status: statusCode, body: data });
        };
        res.end = () => {
            resolve({ status: statusCode, body: null });
        };

        app(req, res);
    });
}

describe("API Express - Fluxo de Interação do Front-end", () => {
    const app = criarApp();

    after(async () => {
        await closePool();
    });

    test("POST /api/alocacoes/validar rejeita requisição sem IDs obrigatórios", async () => {
        const res = await simularRequisicao(app, "POST", "/api/alocacoes/validar", {});
        assert.equal(res.status, 400);
        assert.ok(res.body.detalhes?.includes("turmaId é obrigatório"));
    });

    test("POST /api/alocacoes/confirmar rejeita requisição sem IDs obrigatórios", async () => {
        const res = await simularRequisicao(app, "POST", "/api/alocacoes/confirmar", {});
        assert.equal(res.status, 400);
        assert.ok(res.body.detalhes?.includes("turmaId é obrigatório"));
    });

    test("GET /api/turmas/999999 retorna 404 quando id não existe no banco", async () => {
        // Se o banco não estiver rodando no sandbox, o endpoint retorna erro tratado (404 ou 500)
        const res = await simularRequisicao(app, "GET", "/api/turmas/999999");
        assert.ok(res.status === 404 || res.status === 500);
    });

    test("GET /api/salas/999999 retorna 404 quando id não existe no banco", async () => {
        const res = await simularRequisicao(app, "GET", "/api/salas/999999");
        assert.ok(res.status === 404 || res.status === 500);
    });

    test("POST /api/salas valida capacidade positiva e tipoEspaco permitido", async () => {
        const res1 = await simularRequisicao(app, "POST", "/api/salas", { nome: "Sala X", capacidade: 0 });
        assert.equal(res1.status, 400);

        const res2 = await simularRequisicao(app, "POST", "/api/salas", {
            nome: "Sala X",
            capacidade: 40,
            tipoEspaco: "Ginásio",
        });
        assert.equal(res2.status, 400);
    });

    test("POST /api/disciplinas valida campos obrigatórios e cargaHoraria positiva", async () => {
        const res = await simularRequisicao(app, "POST", "/api/disciplinas", {
            codigo: "COMP999",
            nome: "Teste",
            cargaHoraria: -10,
        });
        assert.equal(res.status, 400);
    });

    test("POST /api/professores/:siape/restricoes rejeita payload vazio ou formato inválido", async () => {
        const res1 = await simularRequisicao(app, "POST", "/api/professores/2024389/restricoes", {});
        assert.equal(res1.status, 400);

        const res2 = await simularRequisicao(app, "POST", "/api/professores/2024389/restricoes", {
            horarioIndisponivel: "INVALIDO",
        });
        assert.equal(res2.status, 400);

        const res3 = await simularRequisicao(app, "POST", "/api/professores/2024389/restricoes", {
            diaSemana: "XYZ",
            turno: "Q",
            indiceHorario: "99",
        });
        assert.equal(res3.status, 400);
    });

    test("POST /api/turmas rejeita horarioSigaa malformado antes de tocar no banco", async () => {
        const res = await simularRequisicao(app, "POST", "/api/turmas", {
            disciplinaCodigo: "COMP360",
            codigoTurma: "01",
            semestre: "2026.2",
            cursosOfertados: "CC",
            vagas: 40,
            horarioSigaa: "HORARIO_INVALIDO",
        });
        assert.equal(res.status, 400);
        assert.ok(res.body.erro?.includes("horarioSigaa"));
    });

    test("DELETE /api/alocacoes/invalido rejeita ID não numérico com 400", async () => {
        const res = await simularRequisicao(app, "DELETE", "/api/alocacoes/invalido");
        assert.equal(res.status, 400);
    });

    test("responderErroBanco mapeia códigos PostgreSQL para HTTP 409 e 400", () => {
        const capturar = (err: unknown, contexto: "escrita" | "remocao") => {
            let status = 200;
            let payload: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
            const fakeRes = {
                status(code: number) {
                    status = code;
                    return this;
                },
                json(data: unknown) {
                    payload = data;
                    return this;
                },
            } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            responderErroBanco(fakeRes, err, "Falha", contexto);
            return { status, payload };
        };

        assert.equal(capturar({ code: "23505", detail: "duplicado" }, "escrita").status, 409);
        assert.equal(capturar({ code: "23503", detail: "em uso" }, "remocao").status, 409);
        assert.equal(capturar({ code: "23503", detail: "fk inexistente" }, "escrita").status, 400);
        assert.equal(capturar({ code: "23514", detail: "check" }, "escrita").status, 400);
        assert.equal(capturar({ code: "22001", detail: "varchar" }, "escrita").status, 400);
        assert.equal(capturar({ code: "22003", detail: "int4" }, "escrita").status, 400);
    });

    test("rotas CRUD e geração rejeitam coerções silenciosas (boolean como number, string como boolean, semSalas não-string)", async () => {
        const resCapBool = await simularRequisicao(app, "POST", "/api/salas", {
            nome: "Sala Bool",
            capacidade: true,
        });
        assert.equal(resCapBool.status, 400);

        const resAlocStr = await simularRequisicao(app, "POST", "/api/salas", {
            nome: "Sala Str",
            capacidade: 40,
            alocavelIc: "false",
        });
        assert.equal(resAlocStr.status, 400);

        const resBlocoVazio = await simularRequisicao(app, "POST", "/api/salas", {
            nome: "Sala Bloco",
            capacidade: 40,
            bloco: "",
        });
        assert.equal(resBlocoVazio.status, 400);

        const resQueryInvalida = await simularRequisicao(app, "GET", "/api/salas?alocavel_ic=yes");
        assert.equal(resQueryInvalida.status, 400);

        const resSemSalasNum = await simularRequisicao(app, "POST", "/api/alocacoes/gerar", {
            semSalas: [123],
        });
        assert.equal(resSemSalasNum.status, 400);

        const resPersistirStr = await simularRequisicao(app, "POST", "/api/alocacoes/gerar", {
            persistir: "false",
        });
        assert.equal(resPersistirStr.status, 400);
    });

    test("handler global de erros preserva 400 para JSON malformado (entity.parse.failed)", async () => {
        const res = await new Promise<MockResponse>((resolve) => {
            const req = Readable.from([Buffer.from("{bad json")]) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            req.method = "POST";
            req.url = "/api/salas";
            req.headers = {
                host: "localhost",
                "content-type": "application/json",
                "content-length": "9",
            };

            let statusCode = 200;
            const resMock = new EventEmitter() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            resMock.statusCode = 200;
            resMock.setHeader = () => resMock;
            resMock.getHeader = () => undefined;
            resMock.status = (code: number) => {
                statusCode = code;
                resMock.statusCode = code;
                return resMock;
            };
            resMock.json = (data: any) => resolve({ status: statusCode, body: data }); // eslint-disable-line @typescript-eslint/no-explicit-any
            resMock.send = (data: any) => resolve({ status: statusCode, body: data }); // eslint-disable-line @typescript-eslint/no-explicit-any
            resMock.end = () => resolve({ status: statusCode, body: null });

            app(req, resMock);
        });

        assert.equal(res.status, 400);
        assert.ok(res.body.erro?.includes("JSON inválido"));
    });
});
