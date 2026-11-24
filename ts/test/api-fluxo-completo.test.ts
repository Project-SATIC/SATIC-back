import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { criarApp } from "../src/api/app.ts";
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
        req.query = {};
        req.params = {};
        req.body = body;

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
    const app = criarApp({
        turmasRepo: {
            listarPorSemestre: async () => [],
            listarTodas: async () => [],
            buscarPorId: async () => null,
        },
        salasRepo: {
            listarTodas: async () => [],
            buscarPorId: async () => null,
        },
    });
    after(() => closePool());

    test("POST /api/alocacoes/validar rejeita requisição sem IDs obrigatórios", async () => {
        const res = await simularRequisicao(app, "POST", "/api/alocacoes/validar", {});
        assert.equal(res.status, 400);
        assert.ok(res.body.erro?.includes("turmaId é obrigatório"));
    });

    test("POST /api/alocacoes/confirmar rejeita requisição sem IDs obrigatórios", async () => {
        const res = await simularRequisicao(app, "POST", "/api/alocacoes/confirmar", {});
        assert.equal(res.status, 400);
        assert.ok(res.body.erro?.includes("turmaId é obrigatório"));
    });

    test("GET /api/turmas/999999 retorna 404 quando id não existe no banco", async () => {
        const res = await simularRequisicao(app, "GET", "/api/turmas/999999");
        assert.equal(res.status, 404);
    });

    test("GET /api/salas/999999 retorna 404 quando id não existe no banco", async () => {
        const res = await simularRequisicao(app, "GET", "/api/salas/999999");
        assert.equal(res.status, 404);
    });
});
