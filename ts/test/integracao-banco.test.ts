/**
 * Fluxo completo repositório -> serviço sobre o BancoFalso (sem PostgreSQL):
 * paridade com o motor Java, preservação de EXTERNA_FIXA/DEFINITIVA, RN-01 com dados do banco
 * e lock do semestre nas escritas.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AlocacaoRepository, SalaRepository, TurmaRepository } from "../src/db/repositories/index.ts";
import { AlocadorService } from "../src/motor/alocador.service.ts";
import { RemanejamentoService } from "../src/motor/remanejamento.service.ts";
import { carregarBase2026_2 } from "../src/seed/seeder.ts";
import { chaveTurma } from "../src/shared/tipos.ts";
import type { Turma } from "../src/shared/tipos.ts";
import type { ExecutorTransacional } from "../src/db/connection.ts";
import { BancoFalso } from "./banco-falso.ts";
import { disciplina, professor, sala, turma } from "./helpers.ts";

const gabarito = JSON.parse(readFileSync(new URL("./fixtures/golden-java-2026-2.json", import.meta.url), "utf8"));

function transacaoNo(banco: BancoFalso): ExecutorTransacional {
    return (fn) => fn(banco);
}

function servicos(banco: BancoFalso) {
    const repos = [new TurmaRepository(), new SalaRepository(), new AlocacaoRepository()] as const;
    return {
        alocador: new AlocadorService(...repos, transacaoNo(banco), banco),
        remanejamento: new RemanejamentoService(...repos, transacaoNo(banco), banco),
        alocacaoRepo: repos[2],
    };
}

function turmaPorChave(banco: BancoFalso, chave: string): Turma {
    const t = banco.turmas.find((x) => chaveTurma(x) === chave);
    assert.ok(t, `turma ${chave} existe na base`);
    return t;
}

describe("Integração repositórios + serviços (BancoFalso)", () => {
    test("gerar pelo caminho do banco reproduz o gabarito do Java (EXTERNA_FIXA bloqueando salas)", async () => {
        const banco = BancoFalso.daBase(carregarBase2026_2());
        const { alocador } = servicos(banco);

        const r = await alocador.gerarAlocacao({ semestre: "2026.2", persistir: false });

        assert.equal(r.resumo.nosVisitados, gabarito.nosVisitados);
        assert.equal(r.resumo.podas, gabarito.podas);
        assert.equal(r.resumo.completo, gabarito.completo);
        assert.equal(r.resumo.preservadas, 2);
        assert.deepEqual(r.pendentes.map(chaveTurma), gabarito.pendentes);
        assert.deepEqual(
            r.alocacoes.map((a) => ({ turma: chaveTurma(a.turma), sala: a.sala.nome, horario: a.horarioCodigo, status: a.status })),
            gabarito.alocacoes,
        );
        assert.equal(banco.alocacoes.length, 2, "preview não grava nada");
    });

    test("sem as reservas EXTERNA_FIXA no banco o resultado diverge do Java (por isso o seed agora as grava)", async () => {
        const banco = BancoFalso.daBase(carregarBase2026_2(), { comReservasExternas: false });
        const r = await servicos(banco).alocador.gerarAlocacao({ persistir: false });
        const resumo = r.alocacoes.map((a) => ({ turma: chaveTurma(a.turma), sala: a.sala.nome, horario: a.horarioCodigo, status: a.status }));
        assert.notDeepEqual(resumo, gabarito.alocacoes);
    });

    test("gerar com persistência troca só os RASCUNHO e preserva EXTERNA_FIXA (regerar é idempotente)", async () => {
        const banco = BancoFalso.daBase(carregarBase2026_2());
        const { alocador } = servicos(banco);

        const r1 = await alocador.gerarAlocacao({ semestre: "2026.2" });
        assert.equal(r1.persistido, true);
        assert.deepEqual(banco.contarPorStatus(), { EXTERNA_FIXA: 2, RASCUNHO: 86 });
        assert.ok(r1.alocacoes.every((a) => typeof a.id === "number"), "alocações gravadas voltam com id");

        await alocador.gerarAlocacao({ semestre: "2026.2" });
        assert.deepEqual(banco.contarPorStatus(), { EXTERNA_FIXA: 2, RASCUNHO: 86 });
        assert.deepEqual(banco.locks, ["satic:alocacao:2026.2", "satic:alocacao:2026.2"], "cada geração trava o semestre");
    });

    test("remanejamento confirmado (DEFINITIVA) sobrevive a uma nova geração", async () => {
        const banco = BancoFalso.daBase(carregarBase2026_2());
        const { alocador, remanejamento, alocacaoRepo } = servicos(banco);
        await alocador.gerarAlocacao({});

        // COMP360-01 (24M34) vai para o LCCV, sala livre nesse horário na solução do motor
        const t = turmaPorChave(banco, "COMP360-01");
        const lccv = banco.salas.find((s) => s.nome === "LCCV")!;
        const conf = await remanejamento.confirmar({ turmaId: t.id, salaId: lccv.id });
        assert.equal(conf.sucesso, true, JSON.stringify(conf.violacoes));
        assert.equal(conf.alocacao?.status, "DEFINITIVA");

        const r2 = await alocador.gerarAlocacao({});
        assert.equal(r2.resumo.preservadas, 3);
        assert.ok(!r2.alocacoes.some((a) => a.turma.id === t.id), "o motor não realoca a turma confirmada");
        const atual = await alocacaoRepo.buscarPorTurmaId(t.id!, banco);
        assert.equal(atual?.sala.nome, "LCCV");
        assert.equal(atual?.status, "DEFINITIVA");
        assert.deepEqual(banco.contarPorStatus(), { EXTERNA_FIXA: 2, RASCUNHO: 85, DEFINITIVA: 1 });

        // preservarDefinitivas = false: o motor volta a decidir a sala dessa turma
        const r3 = await alocador.gerarAlocacao({ preservarDefinitivas: false });
        assert.equal(r3.resumo.preservadas, 2);
        assert.deepEqual(banco.contarPorStatus(), { EXTERNA_FIXA: 2, RASCUNHO: 86 });
    });

    test("RN-01 com dados do banco: co-docente já alocado no mesmo horário bloqueia o movimento", async () => {
        // Regressão: AlocacaoRepository devolvia turmas com professores: [], e RN-01 nunca disparava
        const banco = new BancoFalso();
        const willy = professor("1930412", "WILLY CARVALHO TIENGO");
        const outro = professor("1111111", "OUTRO DOCENTE");
        const d1 = disciplina("COMP100", "TEORIA A", 60, false);
        const d2 = disciplina("COMP200", "TEORIA B", 60, false);
        const a = turma(1, d1, "01", "2026.2", "CC", "2M12", 30, 30, true, willy);
        const b = turma(2, d2, "01", "2026.2", "CC", "2M12", 30, 30, true, outro, willy); // co-docência
        banco.turmas.push(a, b);
        banco.salas.push(sala(1, "Sala 02 IC", 60, "Sala", "IC", true), sala(2, "Sala 03 IC", 55, "Sala", "IC", true));
        banco.inserirAlocacao(1, 1, "2M12", "DEFINITIVA");

        const { remanejamento } = servicos(banco);
        const v = await remanejamento.validar({ turmaId: 2, salaId: 2 });
        assert.equal(v.valida, false);
        assert.deepEqual(v.violacoes.map((x) => x.regra), ["RN-01"]);

        const c = await remanejamento.confirmar({ turmaId: 2, salaId: 2 });
        assert.equal(c.sucesso, false);
        assert.equal(banco.alocacoes.length, 1, "nada é gravado quando a confirmação é recusada");

        // Em outro horário o mesmo movimento é aceito
        const ok = await remanejamento.validar({ turmaId: 2, salaId: 2, horario: "2T12" });
        assert.equal(ok.valida, true);
    });

    test("RN-02 com dados do banco: indisponibilidade cadastrada é hidratada e respeitada", async () => {
        const banco = new BancoFalso();
        const ranilson = professor("2024389", "RANILSON OSCAR ARAUJO PAIVA", { diaSemana: "SEX", turno: "T", indiceHorario: "56" });
        banco.turmas.push(turma(1, disciplina("COMP370", "PROB", 72, false), "01", "2026.2", "CC", "35T12", 30, 30, true, ranilson));
        banco.salas.push(sala(1, "Sala 02 IC", 60, "Sala", "IC", true));

        const { remanejamento } = servicos(banco);
        assert.equal((await remanejamento.validar({ turmaId: 1, salaId: 1 })).valida, true);
        const v = await remanejamento.validar({ turmaId: 1, salaId: 1, horario: "6T56" });
        assert.deepEqual(v.violacoes.map((x) => x.regra), ["RN-02"]);
    });

    test("confirmar trava o semestre da turma antes de ler as alocações", async () => {
        const banco = BancoFalso.daBase(carregarBase2026_2());
        const { remanejamento } = servicos(banco);
        const t = turmaPorChave(banco, "COMP360-01");
        await remanejamento.confirmar({ turmaId: t.id, salaId: banco.salas.find((s) => s.nome === "LCCV")!.id });

        const iLock = banco.sqls.findIndex((s) => s.startsWith("SELECT pg_advisory_xact_lock"));
        const iLeitura = banco.sqls.findIndex((s) => s.startsWith("SELECT a.id AS a_id") && s.includes("WHERE t.semestre"));
        assert.ok(iLock >= 0 && iLeitura > iLock, "lock antes da leitura das alocações do semestre");
        assert.deepEqual(banco.locks, ["satic:alocacao:2026.2"]);
    });

    test("mover uma reserva EXTERNA_FIXA mantém o status (a menos que o cliente informe outro)", async () => {
        const banco = BancoFalso.daBase(carregarBase2026_2());
        const { remanejamento } = servicos(banco);
        const t = turmaPorChave(banco, "IF0001-05");
        const destino = banco.salas.find((s) => s.nome === "Sala 206 BL12")!;

        const c = await remanejamento.confirmar({ turmaId: t.id, salaId: destino.id });
        assert.equal(c.sucesso, true, JSON.stringify(c.violacoes));
        assert.equal(c.alocacao?.status, "EXTERNA_FIXA");
        assert.equal(banco.alocacoes.find((a) => a.turmaId === t.id)?.status, "EXTERNA_FIXA");
    });

    test("turma com horário SIGAA ilegível fica fora da busca e é reportada, sem derrubar a geração", async () => {
        const base = carregarBase2026_2();
        const quebrada = base.turmas.find((t) => chaveTurma(t) === "COMP360-01")!;
        quebrada.horarioSigaa = "24X99";
        const banco = BancoFalso.daBase(base);

        const r = await servicos(banco).alocador.gerarAlocacao({ persistir: false });
        assert.deepEqual(r.horariosInvalidos, ["COMP360-01"]);
        assert.ok(r.pendentes.some((t) => chaveTurma(t) === "COMP360-01"));
        assert.equal(r.resumo.completo, false);
        assert.equal(r.resumo.alocadas, 85);
    });

    test("listagem de alocações traz turmas com docentes e carga horária (contrato para o front)", async () => {
        const banco = BancoFalso.daBase(carregarBase2026_2());
        const lista = await new AlocacaoRepository().listarPorSemestre("2026.2", banco);
        const reserva = lista.find((a) => chaveTurma(a.turma) === "IF0001-05");
        assert.ok(reserva);
        assert.equal(reserva.status, "EXTERNA_FIXA");
        assert.ok(reserva.turma.professores.length > 0, "docentes hidratados");
        for (const p of reserva.turma.professores) {
            assert.equal(typeof reserva.turma.cargaHorariaPorDocente[p.matriculaSiape], "number");
        }
        assert.equal(typeof reserva.dataGeracao, "string");
    });

    test("inserirMuitas falha (em vez de pular em silêncio) quando falta id de turma ou sala", async () => {
        const banco = new BancoFalso();
        const t = turma(null, disciplina("X1", "X", 60, false), "01", "2026.2", "CC", "2M12", 1, 1, true);
        await assert.rejects(
            () => new AlocacaoRepository().inserirMuitas([{ turma: t, sala: sala(1, "S", 10, "Sala", "IC", true), horarioCodigo: "2M12", status: "RASCUNHO" }], banco),
            /sem id/,
        );
    });

    test("UNIQUE (id_turma): a mesma turma não recebe duas alocações", async () => {
        const banco = BancoFalso.daBase(carregarBase2026_2());
        const t = turmaPorChave(banco, "IF0001-05");
        await assert.rejects(
            () => new AlocacaoRepository().inserir({ turma: t, sala: banco.salas[0], horarioCodigo: t.horarioSigaa, status: "RASCUNHO" }, banco),
            /uq_alocacao_turma/,
        );
    });
});
