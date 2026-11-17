/**
 * Porte de SaticValidationSuite.testarModeloSalaEContratoEquals() e
 * testarValidadorDeRestricoesCompleto(), mais os casos novos do porte
 * (escopo espacial e validação de horário remanejado).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLaboratorio, mesmaSala, mesmaTurma } from "../src/shared/tipos.ts";
import type { Alocacao } from "../src/shared/tipos.ts";
import {
    diagnosticarViolacoes,
    isAlocacaoValida,
    verificarCapacidade,
    verificarChoqueProfessor,
    verificarChoqueSala,
    verificarEscopoEspacial,
    verificarIndisponibilidade,
    verificarRequisitoLab,
} from "../src/shared/validador.ts";
import { disciplina, professor, sala, turma } from "./helpers.ts";

describe("Modelo: Sala e contrato de igualdade", () => {
    it("deriva isLaboratorio de tipoEspaco (com e sem acento)", () => {
        assert.equal(isLaboratorio(sala(null, "Sala 01 - IM", 30, "Sala", "IM", true)), false);
        assert.equal(isLaboratorio(sala(null, "Auditório IC", 76, "Auditório", "IC", true)), false);
        assert.equal(isLaboratorio(sala(null, "Lab 01", 65, "Laboratório", "IC", true)), true);
        assert.equal(isLaboratorio(sala(null, "Lab 02", 40, "laboratorio", "IC", true)), true);
    });

    it("salas sem id e com nomes distintos não são iguais (regressão)", () => {
        assert.equal(mesmaSala(sala(null, "Sala 01 - IM", 30, "Sala", "IM", true), sala(null, "Auditório IC", 76, "Auditório", "IC", true)), false);
    });

    it("salas com o mesmo nome são iguais de forma simétrica", () => {
        const a = sala(null, "Sala 01 - IM", 30, "Sala", "IM", true);
        const b = sala(10, "Sala 01 - IM", 30, "Sala", "IM", true);
        assert.equal(mesmaSala(a, b) && mesmaSala(b, a), true);
    });

    it("turmas: id quando ambas têm, senão chave natural", () => {
        const d = disciplina("COMP370", "Probabilidade", 72, false);
        assert.equal(mesmaTurma(turma(1, d, "01", "2026.2", "CC", "2M12", 10, 10, true), turma(1, d, "02", "2026.2", "CC", "2M12", 10, 10, true)), true);
        assert.equal(mesmaTurma(turma(null, d, "01", "2026.2", "CC", "2M12", 10, 10, true), turma(7, d, "01", "2026.2", "EC", "3M12", 10, 10, true)), true);
        assert.equal(mesmaTurma(turma(null, d, "01", "2026.2", "CC", "2M12", 10, 10, true), turma(null, d, "02", "2026.2", "CC", "2M12", 10, 10, true)), false);
    });
});

describe("Validador de restrições (RN-01 a RN-04, choque de sala)", () => {
    const salaPequena = sala(1, "Sala 01 - IM", 30, "Sala", "IM", true);
    const labGrande = sala(2, "Laboratório 01 - IC", 65, "Laboratório", "IC", true);
    const profRanilson = professor("2024389", "RANILSON PAIVA", { diaSemana: "SEX", turno: "T", indiceHorario: "56" });
    const profAlan = professor("1002", "ALAN PEDRO");
    const profWilly = professor("1003", "WILLY TIENGO");
    const p3 = disciplina("COMP373", "Programação 3", 72, true);
    const teoria = disciplina("COMP370", "Probabilidade", 72, false);
    const pds = disciplina("COMP382", "PDS", 72, false);

    const turmaPds = turma(5, pds, "01", "2026.2", "CC", "2345M3456", 40, 40, true, profAlan, profWilly);
    const alocPds: Alocacao = { turma: turmaPds, sala: labGrande, horarioCodigo: turmaPds.horarioSigaa, status: "RASCUNHO" };
    const turmaBloqueada = turma(3, teoria, "01", "2026.2", "CC", "6T56", 20, 20, true, profRanilson);

    it("RN-03: rejeita 45 alunos em sala de 30 e aceita em espaço de 65", () => {
        const lotada = turma(1, teoria, "01", "2026.2", "CC", "35M34", 45, 45, true);
        assert.equal(verificarCapacidade(lotada, salaPequena), false);
        assert.equal(verificarCapacidade(lotada, labGrande), true);
    });

    it("RN-03: usa vagas quando não há matriculados", () => {
        const semMatricula = turma(1, teoria, "01", "2026.2", "CC", "35M34", 31, 0, true);
        assert.equal(verificarCapacidade(semMatricula, salaPequena), false);
    });

    it("RN-04: prática exige Laboratório", () => {
        const turmaLab = turma(2, p3, "02", "2026.2", "CC", "35T34", 30, 30, true);
        assert.equal(verificarRequisitoLab(turmaLab, salaPequena), false);
        assert.equal(verificarRequisitoLab(turmaLab, labGrande), true);
    });

    it("RN-02: bloqueia SEX T56 para Ranilson e libera 35T34", () => {
        assert.equal(verificarIndisponibilidade(turmaBloqueada), false);
        assert.equal(verificarIndisponibilidade(turma(4, p3, "02", "2026.2", "CC", "35T34", 30, 30, true, profRanilson)), true);
    });

    it("RN-01: detecta choque de co-docente (Willy em 2345M3456 x 3M34)", () => {
        const turmaWilly = turma(6, teoria, "01", "2026.2", "EC", "3M34", 25, 25, true, profWilly);
        assert.equal(verificarChoqueProfessor(turmaWilly, [alocPds]), false);
    });

    it("RN-01: ignora a alocação da própria turma", () => {
        assert.equal(verificarChoqueProfessor(turmaPds, [alocPds]), true);
    });

    it("choque de sala: impede 2M34 no mesmo lab e permite 2T12", () => {
        const concorrente = turma(7, teoria, "02", "2026.2", "CC", "2M34", 25, 25, true, profRanilson);
        const semChoque = turma(8, teoria, "03", "2026.2", "CC", "2T12", 25, 25, true, profRanilson);
        assert.equal(verificarChoqueSala(concorrente, labGrande, [alocPds]), false);
        assert.equal(verificarChoqueSala(semChoque, labGrande, [alocPds]), true);
        assert.equal(isAlocacaoValida(semChoque, salaPequena, [alocPds]), true);
    });

    it("diagnóstico aponta exatamente a violação RN-02", () => {
        const v = diagnosticarViolacoes(turmaBloqueada, labGrande, [alocPds]);
        assert.equal(v.length, 1);
        assert.equal(v[0].regra, "RN-02");
    });
});

describe("Extensões do porte TypeScript", () => {
    const teoria = disciplina("COMP370", "Probabilidade", 72, false);
    const salaIc = sala(1, "Sala 02 IC", 60, "Sala", "IC", true);
    const ctec = sala(2, "CTEC", 50, "Sala", "CTEC", false);

    it("escopo espacial: turma do IC não pode ir para sala externa", () => {
        const doIc = turma(1, teoria, "01", "2026.2", "CC", "2M12", 20, 20, true);
        assert.equal(verificarEscopoEspacial(doIc, salaIc), true);
        assert.equal(verificarEscopoEspacial(doIc, ctec), false);
        assert.equal(isAlocacaoValida(doIc, ctec, []), false);
        assert.deepEqual(diagnosticarViolacoes(doIc, ctec, []).map((v) => v.regra), ["ESCOPO"]);
    });

    it("escopo espacial: turma externa (EXTERNA_FIXA) pode ocupar sala do IC", () => {
        const externa = turma(2, disciplina("IF0001", "Física 1", 72, false), "05", "2026.2", "EC", "24T12", 37, 37, false);
        assert.equal(verificarEscopoEspacial(externa, salaIc), true);
    });

    it("valida um encontro remanejado usando o horário informado, não o original", () => {
        const prof = professor("9001", "DOCENTE", { diaSemana: "QUA", turno: "T", indiceHorario: "12" });
        const t = turma(3, teoria, "01", "2026.2", "CC", "35M34", 20, 20, true, prof);
        const ocupante = turma(4, teoria, "02", "2026.2", "CC", "5T12", 20, 20, true);
        const atuais: Alocacao[] = [{ turma: ocupante, sala: salaIc, horarioCodigo: "5T12", status: "DEFINITIVA" }];

        assert.equal(isAlocacaoValida(t, salaIc, atuais), true, "horário original 35M34 está livre");
        // Terça movida para quarta à tarde: cai na indisponibilidade do docente
        assert.equal(verificarIndisponibilidade(t, "4T12 5M34"), false);
        // Quinta movida para quinta à tarde: choca com a ocupante da sala
        assert.equal(verificarChoqueSala(t, salaIc, atuais, "3M34 5T12"), false);
        assert.deepEqual(diagnosticarViolacoes(t, salaIc, atuais, "3M34 5T12").map((v) => v.regra), ["SALA"]);
    });
});
