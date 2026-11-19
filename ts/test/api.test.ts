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
    url: string
): Promise<MockResponse> {
    return new Promise((resolve) => {
        const req = new EventEmitter() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        req.method = method;
        req.url = url;
        req.headers = { host: "localhost" };
        req.query = {};
        req.params = {};

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

describe("API Express - Rotas e Middlewares", () => {
    const app = criarApp({
        testConnection: async () => ({ ok: true, message: "Conectado ao banco 'satic'" }),
    });
    after(() => closePool());

    test("GET / retorna metadados da API e lista de rotas", async () => {
        const res = await simularRequisicao(app, "GET", "/");
        assert.equal(res.status, 200);
        assert.equal(res.body.status, "online");
        assert.ok(Array.isArray(res.body.documentacao?.rotas));
        assert.ok(res.body.documentacao.rotas.includes("/api/turmas"));
        assert.ok(res.body.documentacao.rotas.includes("/api/salas"));
    });

    test("GET /api/health responde 200 com banco ok e 503 com banco indisponível", async () => {
        const okRes = await simularRequisicao(app, "GET", "/api/health");
        assert.equal(okRes.status, 200);
        assert.equal(okRes.body.status, "ok");
        assert.equal(okRes.body.database.conectado, true);

        const appDegradado = criarApp({
            testConnection: async () => ({ ok: false, message: "connect ECONNREFUSED" }),
        });
        const failRes = await simularRequisicao(appDegradado, "GET", "/api/health");
        assert.equal(failRes.status, 503);
        assert.equal(failRes.body.status, "degradado");
        assert.equal(failRes.body.database.conectado, false);
    });

    test("GET /rota-inexistente responde 404 estruturado", async () => {
        const res = await simularRequisicao(app, "GET", "/rota-inexistente");
        assert.equal(res.status, 404);
        assert.ok(res.body.erro?.includes("não encontrada"));
    });
});
