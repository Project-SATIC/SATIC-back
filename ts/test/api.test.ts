import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { criarApp } from "../src/api/app.ts";

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
    const app = criarApp();

    test("GET / retorna metadados da API e lista de rotas", async () => {
        const res = await simularRequisicao(app, "GET", "/");
        assert.equal(res.status, 200);
        assert.equal(res.body.status, "online");
        assert.ok(Array.isArray(res.body.documentacao?.rotas));
        assert.ok(res.body.documentacao.rotas.includes("/api/turmas"));
        assert.ok(res.body.documentacao.rotas.includes("/api/salas"));
    });

    test("GET /api/health responde com status do serviço e diagnóstico do banco", async () => {
        const res = await simularRequisicao(app, "GET", "/api/health");
        assert.equal(res.status, 200);
        assert.equal(res.body.status, "ok");
        assert.ok(res.body.database != null);
        assert.equal(typeof res.body.database.conectado, "boolean");
    });

    test("GET /rota-inexistente responde 404 estruturado", async () => {
        const res = await simularRequisicao(app, "GET", "/rota-inexistente");
        assert.equal(res.status, 404);
        assert.ok(res.body.erro?.includes("não encontrada"));
    });
});
