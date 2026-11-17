/** Porte de SaticValidationSuite.testarMotorDeBuscaHeuristicaEFallback(). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StateSpaceSearch } from "../src/motor/state-space-search.ts";
import { compareToIgnoreCase } from "../src/motor/state-space-search.ts";
import { disciplina, professor, sala, turma } from "./helpers.ts";

describe("Motor StateSpaceSearch (MRV + Best-Fit + recuperação parcial)", () => {
    const salaIm = sala(1, "Sala 01 - IM", 30, "Sala", "IM", true);
    const salaIc = sala(2, "Sala 02 IC", 60, "Sala", "IC", true);
    const labIc = sala(3, "Laboratório 03 - IC", 30, "Laboratório", "IC", true);
    const teoria = disciplina("COMP370", "Probabilidade", 72, false);
    const prof = professor("2024389", "RANILSON PAIVA", { diaSemana: "SEX", turno: "T", indiceHorario: "56" });
    const turmaPequena = turma(10, teoria, "01", "2026.2", "CC", "35M34", 25, 25, true, prof);

    it("cenário A: Best-Fit escolhe Sala 01 - IM (30) em vez do Lab 03 (30) ou da Sala 02 IC (60)", () => {
        const r = new StateSpaceSearch([turmaPequena], [labIc, salaIc, salaIm]).solve();
        assert.equal(r.completo, true);
        assert.equal(r.alocacoes[0].sala.nome, "Sala 01 - IM");
    });

    it("cenário B: bloqueio RN-02 devolve solução parcial preservando a turma válida", () => {
        const bloqueada = turma(11, teoria, "02", "2026.2", "CC", "6T56", 20, 20, true, prof);
        const r = new StateSpaceSearch([turmaPequena, bloqueada], [salaIm, salaIc]).solve();
        assert.equal(r.completo, false);
        assert.equal(r.alocacoes.length, 1);
        assert.equal(r.turmasPendentes.length, 1);
    });

    it("cenário C: turma sem nenhuma sala possível no topo do MRV não impede alocar as demais", () => {
        const gigante = turma(12, teoria, "03", "2026.2", "CC", "24T12", 120, 120, true);
        const r = new StateSpaceSearch([gigante, turmaPequena], [salaIm, salaIc]).solve();
        assert.equal(r.completo, false);
        assert.equal(r.alocacoes.length, 1);
        assert.deepEqual(r.turmasPendentes, [gigante]);
    });

    it("respeita reservas pré-existentes (EXTERNA_FIXA) sem devolvê-las no resultado", () => {
        const externa = turma(13, teoria, "05", "2026.2", "EC", "35M34", 25, 25, false);
        const reserva = { turma: externa, sala: salaIm, horarioCodigo: "35M34", status: "EXTERNA_FIXA" as const };
        const r = new StateSpaceSearch([turmaPequena], [salaIm, salaIc], [reserva]).solve();
        assert.equal(r.completo, true);
        assert.equal(r.alocacoes.length, 1);
        assert.equal(r.alocacoes[0].sala.nome, "Sala 02 IC");
    });

    it("compareToIgnoreCase segue a semântica do Java", () => {
        assert.equal(compareToIgnoreCase("lccv", "LCCV"), 0);
        assert.ok(compareToIgnoreCase("Sala 02 IC", "Sala 03 IC") < 0);
        assert.ok(compareToIgnoreCase("Auditório", "auditorio") > 0);
        assert.ok(compareToIgnoreCase("Sala", "Sala 02") < 0);
    });
});
