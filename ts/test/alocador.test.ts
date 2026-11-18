import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { AlocadorService } from "../src/motor/alocador.service.ts";
import { carregarBase2026_2 } from "../src/seed/seeder.ts";
import type { Alocacao, Sala, Turma } from "../src/shared/tipos.ts";

describe("AlocadorService - Integração do Motor de Busca com Repositórios", () => {
    test("gerarAlocacao aloca base 2026.2 e retorna resumo completo", async () => {
        const base = carregarBase2026_2();
        let limpou = false;
        let alocacoesSalvas: Alocacao[] = [];

        // Mock dos repositórios injetados no service
        const mockTurmaRepo = {
            listarPorSemestre: async () => base.turmas,
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const mockSalaRepo = {
            listarAlocaveisPeloIc: async () => base.salas.filter((s) => s.alocavelIc),
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const mockAlocacaoRepo = {
            listarPorSemestre: async () => [],
            limparPorSemestre: async () => {
                limpou = true;
                return 0;
            },
            inserirMuitas: async (alocs: readonly Alocacao[]) => {
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
        assert.ok(limpou, "Deve limpar alocações anteriores ao persistir");
        assert.equal(alocacoesSalvas.length, 86, "Deve persistir as 86 alocações geradas");
    });

    test("gerarAlocacao respeita persistir = false (modo preview)", async () => {
        const base = carregarBase2026_2();
        let limpou = false;

        const mockTurmaRepo = {
            listarPorSemestre: async () => base.turmas,
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const mockSalaRepo = {
            listarAlocaveisPeloIc: async () => base.salas.filter((s) => s.alocavelIc),
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const mockAlocacaoRepo = {
            listarPorSemestre: async () => [],
            limparPorSemestre: async () => {
                limpou = true;
                return 0;
            },
            inserirMuitas: async () => {
                assert.fail("Não deve chamar inserirMuitas quando persistir = false");
            },
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const service = new AlocadorService(mockTurmaRepo, mockSalaRepo, mockAlocacaoRepo);
        const resultado = await service.gerarAlocacao({ persistir: false });

        assert.equal(resultado.persistido, false);
        assert.equal(resultado.resumo.alocadas, 86);
        assert.equal(limpou, false);
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
