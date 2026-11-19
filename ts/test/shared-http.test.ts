/**
 * Módulos compartilhados servidos ao navegador (/shared/*.js): baixa por HTTP, grava como .js puro
 * e importa como o navegador faria, conferindo que o validador servido dá o mesmo diagnóstico
 * que o do servidor.
 */
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { criarApp } from "../src/api/app.ts";
import { diagnosticarViolacoes } from "../src/shared/validador.ts";
import { carregarBase2026_2 } from "../src/seed/seeder.ts";
import { montarProblema } from "../src/motor/montar-problema.ts";
import { chaveTurma } from "../src/shared/tipos.ts";

describe("GET /shared/*.js (validador compartilhado com o front)", () => {
    let server: Server;
    let base = "";
    let pasta = "";

    before(async () => {
        await new Promise<void>((resolve) => { server = criarApp().listen(0, "127.0.0.1", () => resolve()); });
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        pasta = await mkdtemp(path.join(tmpdir(), "satic-shared-"));
        await writeFile(path.join(pasta, "package.json"), JSON.stringify({ type: "module" }));
    });
    after(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(pasta, { recursive: true, force: true });
    });

    test("serve os quatro módulos como JavaScript, sem tipos e com imports .js", async () => {
        for (const nome of ["grade", "horario-sigaa", "tipos", "validador"]) {
            const res = await fetch(`${base}/shared/${nome}.js`, { headers: { origin: "http://127.0.0.1:8040" } });
            assert.equal(res.status, 200);
            assert.match(res.headers.get("content-type") ?? "", /text\/javascript/);
            assert.equal(res.headers.get("access-control-allow-origin"), "*", "módulo ES cross-origin precisa de CORS");
            const js = await res.text();
            assert.doesNotMatch(js, /from\s+["'][^"']+\.ts["']/, "nenhum import .ts sobra");
            assert.doesNotMatch(js, /^\s*(export\s+)?(interface|type)\s/m, "tipos removidos");
            await writeFile(path.join(pasta, `${nome}.js`), js);
        }
    });

    test("o validador servido, importado como JS puro, dá o mesmo diagnóstico do servidor", async () => {
        const validadorJs = await import(pathToFileURL(path.join(pasta, "validador.js")).href);
        const horarioJs = await import(pathToFileURL(path.join(pasta, "horario-sigaa.js")).href);

        assert.deepEqual([...horarioJs.obterConjuntoSlots("35M34")], ["TER-M3", "TER-M4", "QUI-M3", "QUI-M4"]);
        assert.throws(() => horarioJs.obterConjuntoSlots("9Z1"), /não reconhecido/);

        // Cenário real: cada turma do IC testada em uma sala pequena e numa grande, com as reservas no estado
        const base2026 = carregarBase2026_2();
        const { reservasFixasExternas, salasAlocaveis } = montarProblema(base2026);
        const pequena = salasAlocaveis.find((s) => s.nome === "Sala 01 - IM")!;
        const reservaIf = reservasFixasExternas.find((r) => chaveTurma(r.turma) === "IF0001-05")!;
        let comparados = 0;
        for (const turma of base2026.turmas.filter((t) => t.requerAlocacaoIc)) {
            for (const sala of [pequena, reservaIf.sala]) {
                const noServidor = diagnosticarViolacoes(turma, sala, reservasFixasExternas);
                const noNavegador = validadorJs.diagnosticarViolacoes(turma, sala, reservasFixasExternas);
                assert.deepEqual(noNavegador, noServidor, chaveTurma(turma));
                comparados++;
            }
        }
        assert.equal(comparados, 172);
    });

    test("módulo inexistente ou caminho fora de src/shared responde 404", async () => {
        assert.equal((await fetch(`${base}/shared/motor.js`)).status, 404);
        assert.equal((await fetch(`${base}/shared/..%2Fdb%2Fconnection.js`)).status, 404);
        assert.equal((await fetch(`${base}/shared/validador.ts`)).status, 404);
    });
});
