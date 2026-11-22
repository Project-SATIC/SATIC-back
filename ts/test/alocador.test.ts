import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { AlocadorService } from "../src/motor/alocador.service.ts";
import { carregarBase2026_2 } from "../src/seed/seeder.ts";
import { montarProblema } from "../src/motor/montar-problema.ts";
import type { Alocacao } from "../src/shared/tipos.ts";

describe("AlocadorService - Integração do Motor de Busca com Repositórios", () => {
    test("gerarAlocacao aloca base 2026.2 e persiste de forma atômica preservando EXTERNA_FIXA", async () => {
        const base = carregarBase2026_2();
        const problema = montarProblema(base);
        let semestreSubstituido = "";
        let alocacoesSalvas: Alocacao[] = [];

        // Mock dos repositórios injetados no service
        const mockTurmaRepo = {
            listarPorSemestre: async () => base.turmas,
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const mockSalaRepo = {
            listarAlocaveisPeloIc: async () => problema.salasAlocaveis,
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const mockAlocacaoRepo = {
            listarPorSemestre: async () => problema.reservasFixasExternas,
            substituirPorSemestre: async (semestre: string, alocs: readonly Alocacao[]) => {
                semestreSubstituido = semestre;
                alocacoesSalvas = [...alocs];
            },
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const service = new AlocadorService(mockTurmaRepo, mockSalaRepo, mockAlocacaoRepo);
        const resultado = await service.gerarAlocacao({ semestre: "2026.2", persistir: true });

        assert.equal(resultado.sucesso, true);
        assert.equal(resultado.semestre, "2026.2");
        assert.equal(resultado.persistido, true);
        assert.equal(resultado.resumo.completo, true);
        assert.equal(resultado.resumo.alocadas, 86);
        assert.equal(resultado.resumo.pendentes, 0);
        assert.equal(semestreSubstituido, "2026.2");
        assert.equal(alocacoesSalvas.length, 86, "Deve persistir atomicamente as 86 alocações geradas");
        assert.ok(
            alocacoesSalvas.every((a) => a.status !== "EXTERNA_FIXA"),
            "Reservas EXTERNA_FIXA são preservadas no banco sem serem duplicadas"
        );
    });

    test("gerarAlocacao respeita persistir = false (modo preview)", async () => {
        const base = carregarBase2026_2();
        let substituiu = false;

        const mockTurmaRepo = {
            listarPorSemestre: async () => base.turmas,
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const mockSalaRepo = {
            listarAlocaveisPeloIc: async () => base.salas.filter((s) => s.alocavelIc),
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const mockAlocacaoRepo = {
            listarPorSemestre: async () => [],
            substituirPorSemestre: async () => {
                substituiu = true;
                assert.fail("Não deve chamar substituirPorSemestre quando persistir = false");
            },
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const service = new AlocadorService(mockTurmaRepo, mockSalaRepo, mockAlocacaoRepo);
        const resultado = await service.gerarAlocacao({ persistir: false });

        assert.equal(resultado.persistido, false);
        assert.equal(resultado.resumo.alocadas, 86);
        assert.equal(substituiu, false);
    });

    test("gerarAlocacao falha com erro amigável se semestre não possui turmas", async () => {
        const mockTurmaRepo = {
            listarPorSemestre: async () => [],
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const service = new AlocadorService(mockTurmaRepo);
        await assert.rejects(
            () => service.gerarAlocacao({ semestre: "2099.1" }),
            /Nenhuma turma encontrada no banco para o semestre '2099.1'/
        );
    });
});
