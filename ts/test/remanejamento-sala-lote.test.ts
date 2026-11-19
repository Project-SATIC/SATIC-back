/**
 * Remanejamento com sala automática (mantém a atual ou sugere a melhor livre) e
 * "Confirmar tudo" em lote, sobre o BancoFalso e pela API HTTP.
 */
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { AlocacaoRepository, SalaRepository, TurmaRepository } from "../src/db/repositories/index.ts";
import { RemanejamentoService } from "../src/motor/remanejamento.service.ts";
import { criarApp } from "../src/api/app.ts";
import { BancoFalso } from "./banco-falso.ts";
import { disciplina, professor, sala, turma } from "./helpers.ts";

/** Cenário pequeno: 3 salas teóricas + 1 lab, 3 turmas de 4 aulas (2+2) alocadas. */
function cenario() {
    const banco = new BancoFalso();
    const ana = professor("100", "ANA");
    const bia = professor("200", "BIA");
    const caio = professor("300", "CAIO");
    banco.salas.push(
        sala(1, "Sala 02 IC", 60, "Sala", "IC", true),
        sala(2, "Sala 03 IC", 45, "Sala", "IC", true),
        sala(3, "Sala 04 IC", 40, "Sala", "IC", true),
        sala(4, "Laboratório 01 - IC", 65, "Laboratório", "IC", true),
        sala(5, "CTEC", 80, "Sala", "CTEC", false),
    );
    const teoria = (cod: string) => disciplina(cod, `TEORIA ${cod}`, 60, false);
    const a = turma(1, teoria("C1"), "01", "2026.2", "CC", "35M34", 40, 40, true, ana);
    const b = turma(2, teoria("C2"), "01", "2026.2", "CC", "35M34", 40, 40, true, bia);
    const c = turma(3, teoria("C3"), "01", "2026.2", "EC", "24T12", 30, 30, true, caio);
    for (const t of [a, b, c]) t.aulasSemanais = 4;
    banco.turmas.push(a, b, c);
    banco.inserirAlocacao(1, 3, "35M34", "RASCUNHO"); // A na Sala 04 (40 lugares)
    banco.inserirAlocacao(2, 2, "35M34", "RASCUNHO"); // B na Sala 03
    banco.inserirAlocacao(3, 3, "24T12", "RASCUNHO"); // C na Sala 04, outro horário
    const servico = new RemanejamentoService(new TurmaRepository(), new SalaRepository(), new AlocacaoRepository(), (fn) => fn(banco), banco);
    return { banco, servico };
}

const salaDe = (banco: BancoFalso, turmaId: number) => banco.alocacoes.find((x) => x.turmaId === turmaId);

describe("Remanejamento: sala automática", () => {
    test("sem salaId, mantém a sala atual quando ela continua válida no novo horário", async () => {
        const { servico } = cenario();
        const r = await servico.validar({ turmaId: 1, horario: "24M12" });
        assert.equal(r.valida, true);
        assert.equal(r.origemSala, "mantida");
        assert.equal(r.sala?.nome, "Sala 04 IC");
    });

    test("sem salaId, sugere a melhor sala livre quando a atual fica ocupada (Best-Fit, sem laboratório)", async () => {
        const { servico } = cenario();
        // A vai para 24T12, onde C já ocupa a Sala 04: cabe na Sala 03 (45) antes da Sala 02 (60); lab fica por último
        const r = await servico.validar({ turmaId: 1, horario: "24T12" });
        assert.equal(r.valida, true, JSON.stringify(r.violacoes));
        assert.equal(r.origemSala, "sugerida");
        assert.equal(r.sala?.nome, "Sala 03 IC");
    });

    test("turma do IC nunca recebe sugestão de sala externa", async () => {
        const { banco, servico } = cenario();
        // Ocupa todas as salas do IC em 6M12; só o CTEC (fora do pool) ficaria livre
        for (const [id, s] of [[10, 1], [11, 2], [12, 3], [13, 4]] as const) {
            const t = turma(id, disciplina(`X${id}`, "X", 60, false), "01", "2026.2", "CC", "6M12", 10, 10, true);
            banco.turmas.push(t);
            banco.inserirAlocacao(id, s, "6M12", "DEFINITIVA");
        }
        const r = await servico.validar({ turmaId: 2, horario: "6M1234" }); // mesmas 4 aulas, sobrepondo 6M12
        assert.equal(r.valida, false);
        assert.equal(r.sala, null);
        assert.deepEqual(r.violacoes.map((v) => v.regra), ["SALA"]);
    });

    test("choque de docente: mostra só a RN-01 (trocar de sala não resolveria)", async () => {
        const { banco, servico } = cenario();
        banco.turmas.find((t) => t.id === 2)!.professores.push(professor("100", "ANA")); // ANA também em B
        const r = await servico.validar({ turmaId: 2 });
        assert.deepEqual(r.violacoes.map((v) => v.regra), ["RN-01"]);
    });

    test("mudar o número de aulas ou pôr CC à noite é recusado (FORMATO / TURNO)", async () => {
        const { servico } = cenario();
        assert.deepEqual((await servico.validar({ turmaId: 1, horario: "3M34" })).violacoes.map((v) => v.regra), ["FORMATO"]);
        assert.deepEqual((await servico.validar({ turmaId: 1, horario: "35N12" })).violacoes.map((v) => v.regra), ["TURNO"]);
        assert.deepEqual((await servico.validar({ turmaId: 1, horario: "3M3456" })).violacoes.map((v) => v.regra), [], "4 aulas num dia só respeita o formato");
    });

    test("confirmar sem salaId grava a sala escolhida e informa a origem", async () => {
        const { banco, servico } = cenario();
        const r = await servico.confirmar({ turmaId: 1, horario: "24T12" });
        assert.equal(r.sucesso, true);
        assert.equal(r.origemSala, "sugerida");
        assert.deepEqual({ sala: salaDe(banco, 1)?.salaId, horario: salaDe(banco, 1)?.horario, status: salaDe(banco, 1)?.status },
            { sala: 2, horario: "24T12", status: "DEFINITIVA" });
    });
});

describe("Remanejamento: Confirmar tudo (lote)", () => {
    test("aplica em ordem e dá segunda chance a quem dependia de um movimento posterior", async () => {
        const { banco, servico } = cenario();
        // B quer a Sala 04 (ocupada por A em 35M34); A sai para 6M12. B vem antes no lote.
        const r = await servico.confirmarLote([
            { turmaId: 2, salaId: 3 },
            { turmaId: 1, horario: "6M3456" },
        ]);
        assert.equal(r.aceitos, 2, JSON.stringify(r.resultados));
        assert.equal(salaDe(banco, 2)?.salaId, 3);
        assert.equal(salaDe(banco, 1)?.horario, "6M3456");
        assert.deepEqual(r.resultados.map((x) => x.indice), [0, 1]);
    });

    test("recusados não impedem os válidos; remover tira a turma da grade", async () => {
        const { banco, servico } = cenario();
        const r = await servico.confirmarLote([
            { turmaId: 3, acao: "remover" },
            { turmaId: 1, horario: "3M3" },          // perde aulas: FORMATO
            { turmaId: 2, horario: "24M12" },        // válido, mantém a Sala 03
        ]);
        assert.equal(r.aceitos, 2);
        assert.equal(r.recusados, 1);
        assert.equal(r.resultados[1].sucesso, false);
        assert.equal(r.resultados[1].violacoes?.[0].regra, "FORMATO");
        assert.equal(salaDe(banco, 3), undefined, "C virou pendente");
        assert.equal(salaDe(banco, 2)?.horario, "24M12");
        assert.equal(salaDe(banco, 1)?.horario, "35M34", "A recusada fica como estava");
    });

    test("trava cada semestre envolvido uma vez", async () => {
        const { banco, servico } = cenario();
        await servico.confirmarLote([{ turmaId: 1, horario: "24M12" }, { turmaId: 2, horario: "24M56" }]);
        assert.deepEqual(banco.locks, ["satic:alocacao:2026.2"]);
    });

    test("item malformado recusa o lote inteiro antes de gravar", async () => {
        const { banco, servico } = cenario();
        const antes = JSON.stringify(banco.alocacoes);
        await assert.rejects(() => servico.confirmarLote([{ turmaId: 1, horario: "24M12" }, { turmaId: "x" }]), /movimentos\[1\]: turmaId/);
        await assert.rejects(() => servico.confirmarLote([{ turmaId: 1, acao: "apagar" }]), /acao/);
        await assert.rejects(() => servico.confirmarLote([]), /lista não vazia/);
        assert.equal(JSON.stringify(banco.alocacoes), antes);
    });
});

describe("POST /api/alocacoes/confirmar-lote (HTTP)", () => {
    let server: Server;
    let base = "";
    let banco: BancoFalso;

    before(async () => {
        const c = cenario();
        banco = c.banco;
        const app = criarApp({ alocacoes: { remanejamento: c.servico } });
        await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/alocacoes`;
    });
    after(() => new Promise<void>((resolve) => server.close(() => resolve())));

    const post = async (caminho: string, corpo: unknown) => {
        const res = await fetch(base + caminho, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
        return { status: res.status, body: await res.json() };
    };

    test("200 quando todos entram, 207 quando parte entra, 409 quando nenhum, 400 se malformado", async () => {
        assert.equal((await post("/confirmar-lote", { movimentos: [{ turmaId: 1, horario: "24M12" }] })).status, 200);
        const parcial = await post("/confirmar-lote", { movimentos: [{ turmaId: 2, horario: "24M56" }, { turmaId: 3, horario: "2T1" }] });
        assert.equal(parcial.status, 207);
        assert.equal(parcial.body.aceitos, 1);
        assert.equal((await post("/confirmar-lote", { movimentos: [{ turmaId: 3, horario: "2T1" }] })).status, 409);
        assert.equal((await post("/confirmar-lote", { movimentos: "x" })).status, 400);
        assert.equal(salaDe(banco, 1)?.horario, "24M12");
    });

    test("/validar sem salaId responde a sala escolhida pelo servidor", async () => {
        const r = await post("/validar", { turmaId: 3, horario: "24T34" });
        assert.equal(r.status, 200);
        assert.equal(r.body.valida, true);
        assert.equal(r.body.origemSala, "mantida");
        assert.equal(r.body.sala.nome, "Sala 04 IC");
    });
});
