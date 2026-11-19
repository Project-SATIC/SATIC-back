/** Porte de SaticValidationSuite.testarParserSigaa() + casos de indisponibilidade. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    expandirParaSlotsAtomicos,
    FormatoHorarioInvalidoError,
    haSobreposicao,
    obterConjuntoSlots,
    slotsDaIndisponibilidade,
    tamanhoCacheSlots,
} from "../src/shared/horario-sigaa.ts";

describe("Parser de horários SIGAA", () => {
    it("detecta sobreposição parcial (6M3456 x 6M34)", () => {
        assert.equal(haSobreposicao("6M3456", "6M34"), true);
    });

    it("detecta sobreposição em horário composto (2T56 6T12 x 6T1234)", () => {
        assert.equal(haSobreposicao("2T56 6T12", "6T1234"), true);
    });

    it("não acusa choque entre horários adjacentes (35T12 x 35T34)", () => {
        assert.equal(haSobreposicao("35T12", "35T34"), false);
    });

    it("suporta sábado (7) e noturno (N)", () => {
        assert.ok(obterConjuntoSlots("7M45").has("SAB-M4"));
        assert.ok(obterConjuntoSlots("4N1234").has("QUA-N4"));
    });

    it("expande na ordem dia > hora, sem duplicatas", () => {
        assert.deepEqual(expandirParaSlotsAtomicos("35M34"), ["TER-M3", "TER-M4", "QUI-M3", "QUI-M4"]);
        assert.deepEqual(expandirParaSlotsAtomicos("3M34 3M4"), ["TER-M3", "TER-M4"]);
    });

    it("aceita espaços extras e minúsculas", () => {
        assert.deepEqual(expandirParaSlotsAtomicos("  2t56   6t12 "), ["SEG-T5", "SEG-T6", "SEX-T1", "SEX-T2"]);
    });

    it("rejeita código SIGAA malformado", () => {
        assert.throws(() => obterConjuntoSlots("9X99"), FormatoHorarioInvalidoError);
        assert.throws(() => obterConjuntoSlots("35M7"), FormatoHorarioInvalidoError);
    });

    it("trata horário vazio ou nulo como sem slots e sem sobreposição", () => {
        assert.equal(obterConjuntoSlots("").size, 0);
        assert.equal(obterConjuntoSlots(null).size, 0);
        assert.equal(haSobreposicao(null, "2M12"), false);
    });

    it("expande indisponibilidade com dia por sigla, dígito SIGAA ou múltiplos dígitos", () => {
        assert.deepEqual(slotsDaIndisponibilidade({ professorMatricula: "1", diaSemana: "SEX", turno: "T", indiceHorario: "56" }), ["SEX-T5", "SEX-T6"]);
        assert.deepEqual(slotsDaIndisponibilidade({ professorMatricula: "1", diaSemana: "3", turno: "m", indiceHorario: " 34 " }), ["TER-M3", "TER-M4"]);
        assert.deepEqual(slotsDaIndisponibilidade({ professorMatricula: "1", diaSemana: "35", turno: "T", indiceHorario: "56" }), ["TER-T5", "TER-T6", "QUI-T5", "QUI-T6"]);
    });

    it("mantém CACHE_SLOTS limitado mesmo após milhares de expressões distintas", () => {
        for (let i = 0; i < 5000; i++) {
            const pad = " ".repeat((i % 5) + 1);
            const prefixo = i % 2 === 0 ? "2M12" : "35T34";
            const s = obterConjuntoSlots(`${prefixo}${pad}4N${(i % 4) + 1}`);
            assert.ok(s.size >= 3);
        }
        assert.ok(tamanhoCacheSlots() <= 4096, `cache cresceu para ${tamanhoCacheSlots()}`);
    });
});
