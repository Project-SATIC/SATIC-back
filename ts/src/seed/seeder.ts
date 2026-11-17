/**
 * Carga da base real 2026.2 em memória (porte de dao/DatabaseSeeder.java).
 *
 * Produz as mesmas entidades que o Java grava no SQLite, com os mesmos ids autoincrementais
 * e as mesmas matrículas SIAPE geradas, para que o resultado do motor possa ser comparado
 * com o gabarito do Java. A persistência em SQLite é uma etapa posterior.
 */
import type { Disciplina, Professor, Sala, Turma } from "../shared/tipos.ts";
import { OFERTAS_2026_2 } from "./ofertas-2026-2.ts";

export const SEMESTRE = "2026.2";

export interface DocenteCarga {
    nome: string;
    cargaHoraria: number;
}

export interface OfertaRegistro {
    curso: string;
    codigoDisciplina: string;
    nomeDisciplina: string;
    cargaHoraria: number;
    exigeLab: boolean;
    codigoTurma: string;
    horarioSigaa: string;
    matriculados: number;
    vagas: number;
    localNormalizado: string | null;
    requerAlocacaoIc: boolean;
    docentes: DocenteCarga[];
}

export interface BaseSatic {
    salas: Sala[];
    professores: Professor[];
    disciplinas: Disciplina[];
    turmas: Turma[];
    /** "CODIGO-TURMA" -> nome da sala real no SIGAA. */
    gabaritoSigaa: Map<string, string>;
    turmasConjuntasDeduplicadas: number;
}

type SalaSeed = Omit<Sala, "id">;

export const SALAS_2026_2: readonly SalaSeed[] = [
    // Bloco IC - salas teóricas e auditórios
    { nome: "Sala 02 IC", capacidade: 60, tipoEspaco: "Sala", bloco: "IC", alocavelIc: true },
    { nome: "Sala 03 IC", capacidade: 55, tipoEspaco: "Sala", bloco: "IC", alocavelIc: true },
    { nome: "Sala 04 IC", capacidade: 45, tipoEspaco: "Sala", bloco: "IC", alocavelIc: true },
    { nome: "Auditório IC", capacidade: 76, tipoEspaco: "Auditório", bloco: "IC", alocavelIc: true },
    { nome: "Auditório CEPETEC", capacidade: 70, tipoEspaco: "Auditório", bloco: "IC", alocavelIc: true },
    // Bloco IC - laboratórios
    { nome: "Laboratório 01 - IC", capacidade: 65, tipoEspaco: "Laboratório", bloco: "IC", alocavelIc: true },
    { nome: "Laboratório 02 - IC", capacidade: 50, tipoEspaco: "Laboratório", bloco: "IC", alocavelIc: true },
    { nome: "Laboratório 03 - IC", capacidade: 30, tipoEspaco: "Laboratório", bloco: "IC", alocavelIc: true },
    { nome: "Laboratório 04 - IC", capacidade: 30, tipoEspaco: "Laboratório", bloco: "IC", alocavelIc: true },
    { nome: "Laboratório de Robótica-IC", capacidade: 30, tipoEspaco: "Laboratório", bloco: "IC", alocavelIc: true },
    { nome: "LCCV", capacidade: 60, tipoEspaco: "Laboratório", bloco: "IC", alocavelIc: true },
    // Bloco 12 (alocadas pelo IC)
    { nome: "Sala 206 BL12", capacidade: 40, tipoEspaco: "Sala", bloco: "BL12", alocavelIc: true },
    { nome: "Sala 207 BL12", capacidade: 54, tipoEspaco: "Sala", bloco: "BL12", alocavelIc: true },
    // Instituto de Matemática - salas cedidas ao IC
    { nome: "Sala 01 - IM", capacidade: 30, tipoEspaco: "Sala", bloco: "IM", alocavelIc: true },
    { nome: "Sala 02 - IM", capacidade: 30, tipoEspaco: "Sala", bloco: "IM", alocavelIc: true },
    // Espaços externos (fora do pool do IC)
    { nome: "CTEC", capacidade: 50, tipoEspaco: "Sala", bloco: "CTEC", alocavelIc: false },
    { nome: "Sala 7A - CTEC", capacidade: 60, tipoEspaco: "Sala", bloco: "CTEC", alocavelIc: false },
    { nome: "Sala 03 - IF", capacidade: 55, tipoEspaco: "Sala", bloco: "IF", alocavelIc: false },
    { nome: "Laboratório de Ensino 3 - IF", capacidade: 24, tipoEspaco: "Laboratório", bloco: "IF", alocavelIc: false },
];

const SIAPES_FIXOS: Readonly<Record<string, string>> = {
    "RANILSON OSCAR ARAUJO PAIVA": "2024389",
    "BALDOINO FONSECA DOS SANTOS NETO": "1849201",
    "WILLY CARVALHO TIENGO": "1930412",
    "EVANDRO DE BARROS COSTA": "1520394",
    "MARCIO DE MEDEIROS RIBEIRO": "1659302",
    "GLAUBER RODRIGUES LEITE": "2291043",
};

/** String.hashCode() do Java (32 bits, sobre unidades UTF-16). */
function javaStringHash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return h;
}

/** Reproduz gerarSiapeDeterministico: String.format("IC-%06d", Math.abs(nome.hashCode()) % 999999). */
export function gerarSiapeDeterministico(nome: string): string {
    const fixo = SIAPES_FIXOS[nome];
    if (fixo) return fixo;
    const h = javaStringHash(nome);
    const abs = h === -2147483648 ? h : Math.abs(h); // Math.abs(Integer.MIN_VALUE) continua negativo no Java
    const r = abs % 999999;
    return "IC-" + (r < 0 ? "-" + String(-r).padStart(5, "0") : String(r).padStart(6, "0"));
}

/** Comparação binária (memcmp UTF-8 do SQLite equivale à ordem de code units para o BMP). */
function cmpBinario(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** Monta a base deduplicando turmas conjuntas CC + EC pela chave (semestre, disciplina, turma). */
export function carregarBase2026_2(ofertas: readonly OfertaRegistro[] = OFERTAS_2026_2): BaseSatic {
    const salas: Sala[] = SALAS_2026_2.map((s, i) => ({ id: i + 1, ...s }));
    const disciplinas = new Map<string, Disciplina>();
    const professores = new Map<string, Professor>();
    const turmas = new Map<string, Turma>();
    const gabaritoSigaa = new Map<string, string>();
    let conjuntas = 0;

    for (const reg of ofertas) {
        let disc = disciplinas.get(reg.codigoDisciplina);
        if (!disc) {
            disc = { codigo: reg.codigoDisciplina, nome: reg.nomeDisciplina, cargaHoraria: reg.cargaHoraria, exigeLaboratorio: reg.exigeLab };
            disciplinas.set(reg.codigoDisciplina, disc);
        }
        if (reg.localNormalizado != null) {
            gabaritoSigaa.set(`${reg.codigoDisciplina}-${reg.codigoTurma}`, reg.localNormalizado);
        }

        const chave = `${SEMESTRE}|${reg.codigoDisciplina}|${reg.codigoTurma}`;
        const existente = turmas.get(chave);
        if (existente) {
            if (!existente.cursosOfertados.includes(reg.curso)) {
                existente.cursosOfertados = `${existente.cursosOfertados}, ${reg.curso}`;
            }
            conjuntas++;
            continue;
        }

        const nova: Turma = {
            id: turmas.size + 1,
            disciplina: disc,
            professores: [],
            cargaHorariaPorDocente: {},
            codigoTurma: reg.codigoTurma,
            semestre: SEMESTRE,
            cursosOfertados: reg.curso,
            horarioSigaa: reg.horarioSigaa,
            vagas: reg.vagas,
            matriculados: reg.matriculados,
            requerAlocacaoIc: reg.requerAlocacaoIc,
        };
        for (const dc of reg.docentes) {
            let prof = professores.get(dc.nome);
            if (!prof) {
                prof = { matriculaSiape: gerarSiapeDeterministico(dc.nome), nome: dc.nome, indisponibilidades: [] };
                professores.set(dc.nome, prof);
            }
            if (!nova.professores.some((p) => p.matriculaSiape === prof.matriculaSiape)) {
                nova.professores.push(prof);
                nova.cargaHorariaPorDocente[prof.matriculaSiape] = dc.cargaHoraria;
            }
        }
        turmas.set(chave, nova);
    }

    return {
        salas,
        professores: [...professores.values()],
        disciplinas: [...disciplinas.values()],
        // Mesma ordem de TurmaDAO.listarTodas(): ORDER BY d.codigo, t.codigo_turma
        turmas: [...turmas.values()].sort((a, b) =>
            cmpBinario(a.disciplina.codigo, b.disciplina.codigo) || cmpBinario(a.codigoTurma, b.codigoTurma)),
        gabaritoSigaa,
        turmasConjuntasDeduplicadas: conjuntas,
    };
}

/** Mesma ordem de SalaDAO.listarAlocaveisPeloIc(): WHERE alocavel_ic = 1 ORDER BY bloco, nome. */
export function salasAlocaveisPeloIc(salas: readonly Sala[]): Sala[] {
    return salas.filter((s) => s.alocavelIc)
        .sort((a, b) => cmpBinario(a.bloco, b.bloco) || cmpBinario(a.nome, b.nome));
}
