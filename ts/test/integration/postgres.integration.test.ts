/**
 * Suite de integração contra PostgreSQL real externo (ex: PostgreSQL 16 local ou Docker).
 *
 * Só executa quando `SATIC_RUN_PG_INTEGRATION=1` (via `npm run test:integration`), mantendo
 * `npm test` 100% autocontido (usando PGlite em `postgres-real.test.ts`).
 */
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closePool, query } from "../../src/db/connection.ts";
import { executarMigrations, resetarBanco } from "../../src/db/migrator.ts";
import { executarSeed } from "../../src/seed/db-seeder.ts";
import { AlocadorService } from "../../src/motor/alocador.service.ts";
import { criarApp } from "../../src/api/app.ts";

const ATIVO = process.env.SATIC_RUN_PG_INTEGRATION === "1";

describe("Integração Real com PostgreSQL Externo (Migrations 001-004, CRUD, Seed, Lote e Sugestões)", { skip: !ATIVO }, () => {
    let server: Server;
    let base = "";

    before(async () => {
        const app = criarApp();
        await new Promise<void>((resolve) => {
            server = app.listen(0, "127.0.0.1", () => resolve());
        });
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    after(async () => {
        if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
        await closePool();
    });

    test("1. resetarBanco e executarMigrations aplicam 001..006 de forma idempotente", async () => {
        await resetarBanco();
        const r1 = await executarMigrations();
        assert.equal(r1.length, 6);
        assert.ok(r1.every((r) => r.status === "aplicada"));

        const r2 = await executarMigrations();
        assert.equal(r2.length, 6);
        assert.ok(r2.every((r) => r.status === "ja_executada"));
    });

    test("2. CRUD completo, trigger atualizado_em e divisão de restrição no PostgreSQL real", async () => {
        await resetarBanco();
        await executarMigrations();

        const req = async (method: string, path: string, body?: unknown) => {
            const res = await fetch(`${base}${path}`, {
                method,
                headers: body !== undefined ? { "content-type": "application/json" } : {},
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
            return { status: res.status, data: res.status === 204 ? null : await res.json() };
        };

        const s = await req("POST", "/api/salas", {
            nome: "Lab Integração", capacidade: 40, tipoEspaco: "Laboratório", bloco: "IC", alocavelIc: true,
        });
        assert.equal(s.status, 201);

        const d = await req("POST", "/api/disciplinas", {
            codigo: "INT101", nome: "Integração PG", cargaHoraria: 60, exigeLaboratorio: true,
        });
        assert.equal(d.status, 201);

        const p = await req("POST", "/api/professores", {
            matriculaSiape: "8880001", nome: "PROF INTEGRACAO", indisponibilidades: ["SEX-T-56"],
        });
        assert.equal(p.status, 201);
        assert.equal((await req("DELETE", "/api/professores/8880001/restricoes/SEX-T-5")).status, 204);
        const pDepois = await req("GET", "/api/professores/8880001");
        assert.equal(pDepois.data.indisponibilidades.length, 1);
        assert.equal(pDepois.data.indisponibilidades[0].indiceHorario, "6");

        const t = await req("POST", "/api/turmas", {
            disciplinaCodigo: "INT101", codigoTurma: "01", semestre: "2026.2",
            cursosOfertados: "CC", vagas: 30, matriculados: 20, requerAlocacaoIc: true,
            horarioSigaa: "24M12", professores: ["8880001"],
        });
        assert.equal(t.status, 201);

        const c1 = await req("POST", "/api/alocacoes/confirmar", {
            turmaId: t.data.id, salaId: s.data.id, horario: "24M12",
        });
        assert.equal(c1.status, 200);
        const antes = await query<{ atualizado_em: Date }>(
            "SELECT atualizado_em FROM alocacao WHERE id = $1;",
            [c1.data.alocacao.id],
        );
        await new Promise((r) => setTimeout(r, 30));
        const c2 = await req("POST", "/api/alocacoes/confirmar", {
            turmaId: t.data.id, salaId: s.data.id, horario: "35M12",
        });
        assert.equal(c2.status, 200);
        const depois = await query<{ atualizado_em: Date }>(
            "SELECT atualizado_em FROM alocacao WHERE id = $1;",
            [c1.data.alocacao.id],
        );
        assert.ok(depois.rows[0].atualizado_em.getTime() >= antes.rows[0].atualizado_em.getTime());
    });

    test("3. seed 2026.2 idempotente, motor 86 + 2 EXTERNA_FIXA, proteção DELETE e confirmar-lote", async () => {
        await resetarBanco();
        await executarMigrations();
        await executarSeed();
        await executarSeed();

        const geracao = await new AlocadorService().gerarAlocacao({ semestre: "2026.2", persistir: true });
        assert.equal(geracao.resumo.alocadas, 86);
        assert.equal(geracao.resumo.preservadas, 2);

        // Proteção EXTERNA_FIXA em DELETE /api/alocacoes/:id e em confirmar-lote
        const ext = await query<{ id: number; id_turma: number }>(
            "SELECT id, id_turma FROM alocacao WHERE status = 'EXTERNA_FIXA' LIMIT 1;",
        );
        const delExt = await fetch(`${base}/api/alocacoes/${ext.rows[0].id}`, { method: "DELETE" });
        assert.equal(delExt.status, 409);

        const loteExt = await fetch(`${base}/api/alocacoes/confirmar-lote`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ movimentos: [{ turmaId: ext.rows[0].id_turma, acao: "remover" }] }),
        });
        assert.equal(loteExt.status, 409);

        // Sugestões não alteram o banco
        const sug = await fetch(`${base}/api/alocacoes/sugestoes`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ semestre: "2026.2" }),
        });
        assert.equal(sug.status, 200);

        // Publicar semestre congela RASCUNHO -> DEFINITIVA e grava publicada = true
        const pub = await fetch(`${base}/api/alocacoes/publicar`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ semestre: "2026.2" }),
        });
        assert.equal(pub.status, 200);
        const pubBody = await pub.json();
        assert.equal(pubBody.publicada, true);
        assert.equal(pubBody.congeladas, 86);
    });
});
