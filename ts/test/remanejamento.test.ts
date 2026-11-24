import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { RemanejamentoService } from "../src/motor/remanejamento.service.ts";
import type { Alocacao, Sala, Turma } from "../src/shared/tipos.ts";
import { semTransacao } from "./helpers.ts";

describe("RemanejamentoService - Validação e Confirmação de Movimentos", () => {
    const salaPequena: Sala = {
        id: 1,
        nome: "Sala 01 - IM",
        capacidade: 30,
        tipoEspaco: "Sala",
        bloco: "IM",
        alocavelIc: true,
    };

    const salaGrande: Sala = {
        id: 2,
        nome: "Sala 02 IC",
        capacidade: 60,
        tipoEspaco: "Sala",
        bloco: "IC",
        alocavelIc: true,
    };

    const turmaGrande: Turma = {
        id: 10,
        disciplina: {
            codigo: "COMP360",
            nome: "Introdução à Programação",
            cargaHoraria: 60,
            exigeLaboratorio: false,
        },
        professores: [{ matriculaSiape: "1001", nome: "Docente Teste", indisponibilidades: [] }],
        cargaHorariaPorDocente: { "1001": 60 },
        codigoTurma: "01",
        semestre: "2026.2",
        cursosOfertados: "CC",
        horarioSigaa: "24M12",
        vagas: 50,
        matriculados: 50,
        requerAlocacaoIc: true,
    };

    test("validar detecta violação de capacidade (RN-03) quando turma excede sala", async () => {
        const mockTurmaRepo = {
            buscarPorId: async () => turmaGrande,
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const mockSalaRepo = {
            buscarPorId: async () => salaPequena,
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const mockAlocacaoRepo = {
            listarPorSemestre: async () => [],
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const service = new RemanejamentoService(mockTurmaRepo, mockSalaRepo, mockAlocacaoRepo, semTransacao);
        const res = await service.validar({ turmaId: 10, salaId: 1 });

        assert.equal(res.valida, false);
        assert.equal(res.violacoes.length, 1);
        assert.equal(res.violacoes[0].regra, "RN-03");
    });

    test("validar aprova movimento quando todas as restrições são satisfeitas", async () => {
        const mockTurmaRepo = {
            buscarPorId: async () => turmaGrande,
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const mockSalaRepo = {
            buscarPorId: async () => salaGrande,
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const mockAlocacaoRepo = {
            listarPorSemestre: async () => [],
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const service = new RemanejamentoService(mockTurmaRepo, mockSalaRepo, mockAlocacaoRepo, semTransacao);
        const res = await service.validar({ turmaId: 10, salaId: 2, horario: "24M12" });

        assert.equal(res.valida, true);
        assert.equal(res.violacoes.length, 0);
    });

    test("confirmar recusa movimento inválido sem alterar o banco", async () => {
        const mockTurmaRepo = {
            buscarPorId: async () => turmaGrande,
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const mockSalaRepo = {
            buscarPorId: async () => salaPequena,
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        let atualizou = false;
        const mockAlocacaoRepo = {
            listarPorSemestre: async () => [],
            atualizarSalaEHorario: async () => {
                atualizou = true;
                return true;
            },
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const service = new RemanejamentoService(mockTurmaRepo, mockSalaRepo, mockAlocacaoRepo, semTransacao);
        const res = await service.confirmar({ turmaId: 10, salaId: 1 });

        assert.equal(res.sucesso, false);
        assert.ok(res.violacoes && res.violacoes.length > 0);
        assert.equal(atualizou, false, "Não deve atualizar o banco se a validação falhar");
    });

    test("confirmar atualiza a alocação no banco se o movimento for válido", async () => {
        const mockTurmaRepo = {
            buscarPorId: async () => turmaGrande,
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const mockSalaRepo = {
            buscarPorId: async () => salaGrande,
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        let alocacaoAtualizadaId = -1;
        let novaSalaId = -1;
        let novoHorario = "";

        // A alocação atual da turma vem na listagem do semestre, como no banco
        const mockAlocacaoRepo = {
            listarPorSemestre: async () => [{
                id: 99,
                turma: turmaGrande,
                sala: salaPequena,
                horarioCodigo: "24M12",
                status: "RASCUNHO",
            }],
            atualizarSalaEHorario: async (id: number, sId: number, h: string) => {
                alocacaoAtualizadaId = id;
                novaSalaId = sId;
                novoHorario = h;
                return true;
            },
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        const service = new RemanejamentoService(mockTurmaRepo, mockSalaRepo, mockAlocacaoRepo, semTransacao);
        const res = await service.confirmar({
            turmaId: 10,
            salaId: 2,
            horario: "35T12",
            status: "DEFINITIVA",
        });

        assert.equal(res.sucesso, true);
        assert.equal(alocacaoAtualizadaId, 99);
        assert.equal(novaSalaId, 2);
        assert.equal(novoHorario, "35T12");
        assert.equal(res.alocacao?.horarioCodigo, "35T12");
        assert.equal(res.alocacao?.status, "DEFINITIVA");
    });
});
