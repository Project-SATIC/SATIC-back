import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { formatarHorarioIndisponivel, parseHorarioIndisponivel } from "../src/db/repositories/professor.repository.ts";
import {
    DisciplinaRepository,
    ProfessorRepository,
    SalaRepository,
    TurmaRepository,
    AlocacaoRepository,
} from "../src/db/repositories/index.ts";

describe("Repositórios e Mapeamentos do Banco", () => {
    test("parseHorarioIndisponivel suporta formato 'SEX-T-56' e 'SEX:T:56'", () => {
        const ind1 = parseHorarioIndisponivel("2024389", "SEX-T-56");
        assert.equal(ind1.diaSemana, "SEX");
        assert.equal(ind1.turno, "T");
        assert.equal(ind1.indiceHorario, "56");

        const ind2 = parseHorarioIndisponivel("2024389", "SEX:T:56");
        assert.equal(ind2.diaSemana, "SEX");
        assert.equal(ind2.turno, "T");
        assert.equal(ind2.indiceHorario, "56");
    });

    test("parseHorarioIndisponivel suporta formato SIGAA compacto '6T56'", () => {
        const ind = parseHorarioIndisponivel("2024389", "6T56");
        assert.equal(ind.diaSemana, "6");
        assert.equal(ind.turno, "T");
        assert.equal(ind.indiceHorario, "56");
    });

    test("formatarHorarioIndisponivel gera representação 'DIA-TURNO-HORAS'", () => {
        const str = formatarHorarioIndisponivel({
            professorMatricula: "2024389",
            diaSemana: "SEX",
            turno: "T",
            indiceHorario: "56",
        });
        assert.equal(str, "SEX-T-56");
    });

    test("instanciação de todos os repositórios sem erros", () => {
        assert.ok(new DisciplinaRepository());
        assert.ok(new ProfessorRepository());
        assert.ok(new SalaRepository());
        assert.ok(new TurmaRepository());
        assert.ok(new AlocacaoRepository());
    });
});
