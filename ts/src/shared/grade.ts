/**
 * Modelo de grade em aulas atômicas de 50 minutos (compartilhado entre back e front).
 *
 * Uma turma ocupa um conjunto de aulas "DIA-TURNO+ÍNDICE" (ex: "TER-M3"), que é o que o parser
 * SIGAA já produz. Este módulo acrescenta:
 *  - o relógio de cada aula (para a grade, a exportação ICS e o PDF);
 *  - os cursos e os turnos em que cada um tem aula (CC/EC manhã e tarde, IA só à noite);
 *  - a decomposição de um horário em blocos (um bloco = aulas seguidas no mesmo dia e turno);
 *  - as regras de formato combinadas com a secretaria em 19/11/2026;
 *  - a montagem do código SIGAA a partir de aulas avulsas (usada ao arrastar aulas na grade).
 *
 * Módulo puro: sem APIs do Node e só com sintaxe TypeScript apagável (servido em /shared/grade.js).
 */
import { DIAS_SIGAA, obterConjuntoSlots } from "./horario-sigaa.ts";
import type { DiaSemana, Turma, Turno } from "./tipos.ts";

/** Dias na ordem da semana (o SIGAA usa 2..7 = SEG..SAB). */
export const DIAS_GRADE: readonly DiaSemana[] = Object.freeze(["SEG", "TER", "QUA", "QUI", "SEX", "SAB"]);

/** Quantas aulas cada turno tem: manhã e tarde de 1 a 6, noite de 1 a 4. */
export const AULAS_POR_TURNO: Readonly<Record<Turno, number>> = Object.freeze({ M: 6, T: 6, N: 4 });

export interface AulaRelogio {
    /** Ex: "M1", "T6", "N4". */
    id: string;
    turno: Turno;
    indice: number;
    inicio: string;
    fim: string;
}

/** Relógio das aulas de 50 min (UFAL). Intervalos de 10 min entre M2/M3, M4/M5, T2/T3, T4/T5 e N2/N3. */
export const RELOGIO_AULAS: readonly AulaRelogio[] = Object.freeze([
    { id: "M1", turno: "M", indice: 1, inicio: "07:30", fim: "08:20" },
    { id: "M2", turno: "M", indice: 2, inicio: "08:20", fim: "09:10" },
    { id: "M3", turno: "M", indice: 3, inicio: "09:20", fim: "10:10" },
    { id: "M4", turno: "M", indice: 4, inicio: "10:10", fim: "11:00" },
    { id: "M5", turno: "M", indice: 5, inicio: "11:10", fim: "12:00" },
    { id: "M6", turno: "M", indice: 6, inicio: "12:00", fim: "12:50" },
    { id: "T1", turno: "T", indice: 1, inicio: "13:30", fim: "14:20" },
    { id: "T2", turno: "T", indice: 2, inicio: "14:20", fim: "15:10" },
    { id: "T3", turno: "T", indice: 3, inicio: "15:20", fim: "16:10" },
    { id: "T4", turno: "T", indice: 4, inicio: "16:10", fim: "17:00" },
    { id: "T5", turno: "T", indice: 5, inicio: "17:10", fim: "18:00" },
    { id: "T6", turno: "T", indice: 6, inicio: "18:00", fim: "18:50" },
    { id: "N1", turno: "N", indice: 1, inicio: "19:00", fim: "19:50" },
    { id: "N2", turno: "N", indice: 2, inicio: "19:50", fim: "20:40" },
    { id: "N3", turno: "N", indice: 3, inicio: "20:50", fim: "21:40" },
    { id: "N4", turno: "N", indice: 4, inicio: "21:40", fim: "22:30" },
] as AulaRelogio[]);

export interface Curso {
    sigla: string;
    nome: string;
    /** Turnos em que o curso tem aula; o motor só procura horários nesses turnos. */
    turnos: readonly Turno[];
}

/** Os três cursos do IC. IA é noturno e o único curso à noite, por isso quase não tem conflitos. */
export const CURSOS: readonly Curso[] = Object.freeze([
    { sigla: "CC", nome: "Ciência da Computação", turnos: ["M", "T"] },
    { sigla: "EC", nome: "Engenharia de Computação", turnos: ["M", "T"] },
    { sigla: "IA", nome: "Inteligência Artificial", turnos: ["N"] },
] as Curso[]);

/** Siglas em "CC, EC" -> ["CC", "EC"]. */
export function siglasDosCursos(cursosOfertados: string | null | undefined): string[] {
    return (cursosOfertados ?? "").split(/[,/;]/).map((s) => s.trim().toUpperCase()).filter(Boolean);
}

/** Turnos permitidos para a turma: união dos turnos dos seus cursos (curso desconhecido libera todos). */
export function turnosPermitidos(turma: Pick<Turma, "cursosOfertados">): Turno[] {
    const siglas = siglasDosCursos(turma.cursosOfertados);
    const turnos = new Set<Turno>();
    for (const sigla of siglas) {
        const curso = CURSOS.find((c) => c.sigla === sigla);
        if (!curso) return ["M", "T", "N"];
        for (const t of curso.turnos) turnos.add(t);
    }
    return turnos.size > 0 ? (["M", "T", "N"] as Turno[]).filter((t) => turnos.has(t)) : ["M", "T", "N"];
}

export interface Aula {
    dia: DiaSemana;
    turno: Turno;
    indice: number;
}

/** "TER-M3" -> { dia: "TER", turno: "M", indice: 3 }. */
export function lerAula(slot: string): Aula {
    const m = /^([A-Z]{3})-([MTN])(\d)$/.exec(slot);
    if (!m) throw new Error(`Aula inválida: ${slot}`);
    return { dia: m[1] as DiaSemana, turno: m[2] as Turno, indice: Number(m[3]) };
}

export function idAula(a: Aula): string {
    return `${a.dia}-${a.turno}${a.indice}`;
}

/** Aulas de um horário SIGAA (horário vazio = nenhuma aula). */
export function aulasDoHorario(horario: string | null | undefined): Aula[] {
    return [...obterConjuntoSlots(horario)].map(lerAula);
}

export interface Bloco {
    dia: DiaSemana;
    turno: Turno;
    /** Primeiro e último índice do bloco (ex: 3 e 4 para M3-M4). */
    inicio: number;
    fim: number;
    tamanho: number;
}

const ORDEM_TURNO: Readonly<Record<string, number>> = { M: 0, T: 1, N: 2 };

function compararAulas(a: Aula, b: Aula): number {
    return DIAS_GRADE.indexOf(a.dia) - DIAS_GRADE.indexOf(b.dia)
        || ORDEM_TURNO[a.turno] - ORDEM_TURNO[b.turno]
        || a.indice - b.indice;
}

/** Agrupa aulas em blocos contínuos (mesmo dia, mesmo turno, índices seguidos). */
export function blocosDasAulas(aulas: readonly Aula[]): Bloco[] {
    const ordenadas = [...aulas].sort(compararAulas);
    const blocos: Bloco[] = [];
    for (const a of ordenadas) {
        const ultimo = blocos[blocos.length - 1];
        if (ultimo && ultimo.dia === a.dia && ultimo.turno === a.turno && ultimo.fim + 1 === a.indice) {
            ultimo.fim = a.indice;
            ultimo.tamanho++;
        } else {
            blocos.push({ dia: a.dia, turno: a.turno, inicio: a.indice, fim: a.indice, tamanho: 1 });
        }
    }
    return blocos;
}

export function blocosDoHorario(horario: string | null | undefined): Bloco[] {
    return blocosDasAulas(aulasDoHorario(horario));
}

/** "Formato" de um horário: tamanhos dos blocos em ordem decrescente (ex: [2, 2] para 35M34). */
export function formatoDoHorario(horario: string | null | undefined): number[] {
    return blocosDoHorario(horario).map((b) => b.tamanho).sort((a, b) => b - a);
}

/**
 * Monta o código SIGAA canônico a partir de aulas avulsas, agrupando dias com o mesmo bloco:
 * TER-M3, TER-M4, QUI-M3, QUI-M4 -> "35M34"; SEG-T5, SEG-T6, SEX-T1, SEX-T2 -> "2T56 6T12".
 * O resultado volta às mesmas aulas pelo parser (obterConjuntoSlots).
 */
export function montarHorarioSigaa(aulas: readonly (Aula | string)[]): string {
    const lista = aulas.map((a) => (typeof a === "string" ? lerAula(a) : a));
    const codigoDia = new Map(Object.entries(DIAS_SIGAA).map(([cod, dia]) => [dia, cod]));
    // dia -> turno -> índices
    const porDiaTurno = new Map<string, number[]>();
    for (const a of lista) {
        const chave = `${a.dia}|${a.turno}`;
        const idx = porDiaTurno.get(chave) ?? [];
        if (!idx.includes(a.indice)) idx.push(a.indice);
        porDiaTurno.set(chave, idx);
    }
    // (turno + índices) -> dias
    const grupos = new Map<string, { turno: Turno; indices: string; dias: DiaSemana[] }>();
    for (const [chave, idx] of porDiaTurno) {
        const [dia, turno] = chave.split("|") as [DiaSemana, Turno];
        const indices = idx.sort((x, y) => x - y).join("");
        const g = grupos.get(`${turno}${indices}`) ?? { turno, indices, dias: [] };
        g.dias.push(dia);
        grupos.set(`${turno}${indices}`, g);
    }
    return [...grupos.values()]
        .map((g) => ({ ...g, dias: g.dias.sort((a, b) => DIAS_GRADE.indexOf(a) - DIAS_GRADE.indexOf(b)) }))
        .sort((a, b) => ORDEM_TURNO[a.turno] - ORDEM_TURNO[b.turno]
            || DIAS_GRADE.indexOf(a.dias[0]) - DIAS_GRADE.indexOf(b.dias[0])
            || a.indices.localeCompare(b.indices))
        .map((g) => `${g.dias.map((d) => codigoDia.get(d)).join("")}${g.turno}${g.indices}`)
        .join(" ");
}

/** Aulas por semana de um horário (útil quando a turma ainda não tem o valor cadastrado). */
export function contarAulas(horario: string | null | undefined): number {
    return obterConjuntoSlots(horario).size;
}

export interface ProblemaFormato {
    regra: "FORMATO" | "TURNO";
    mensagem: string;
}

/**
 * Regras de forma de um horário (combinadas em 19/11/2026):
 *  - mantém o número de aulas semanais da turma (quando cadastrado);
 *  - no máximo um bloco contínuo por dia: sem buraco e sem dois turnos no mesmo dia;
 *  - um bloco não cruza turno (consequência da regra anterior);
 *  - só turnos do(s) curso(s) da turma (CC/EC manhã e tarde, IA noite).
 * Horário vazio (turma pendente sem horário) não gera problema aqui.
 */
export function verificarFormatoHorario(
    turma: Pick<Turma, "cursosOfertados"> & { aulasSemanais?: number | null },
    horario: string | null | undefined,
): ProblemaFormato[] {
    const aulas = aulasDoHorario(horario);
    if (aulas.length === 0) return [];
    const problemas: ProblemaFormato[] = [];

    const foraRelogio = aulas.filter((a) => a.indice < 1 || a.indice > AULAS_POR_TURNO[a.turno]).map(idAula);
    if (foraRelogio.length > 0) {
        problemas.push({
            regra: "FORMATO",
            mensagem: `Aula fora do relógio do turno: ${foraRelogio.join(", ")} (noite vai de N1 a N4).`,
        });
    }

    const esperado = turma.aulasSemanais;
    if (esperado != null && esperado > 0 && aulas.length !== esperado) {
        problemas.push({ regra: "FORMATO", mensagem: `A turma tem ${esperado} aula(s) por semana, mas o horário ${horario} tem ${aulas.length}.` });
    }

    const blocos = blocosDasAulas(aulas);
    const diasRepetidos = DIAS_GRADE.filter((d) => blocos.filter((b) => b.dia === d).length > 1);
    if (diasRepetidos.length > 0) {
        problemas.push({ regra: "FORMATO", mensagem: `Mais de um bloco no mesmo dia (${diasRepetidos.join(", ")}): as aulas de um dia devem ser seguidas e no mesmo turno.` });
    }

    const permitidos = turnosPermitidos(turma);
    const fora = [...new Set(aulas.filter((a) => !permitidos.includes(a.turno)).map((a) => a.turno))];
    if (fora.length > 0) {
        const nomes: Record<string, string> = { M: "manhã", T: "tarde", N: "noite" };
        problemas.push({
            regra: "TURNO",
            mensagem: `Turno fora do curso (${turma.cursosOfertados}): ${fora.map((t) => nomes[t]).join(", ")}. Permitido: ${permitidos.map((t) => nomes[t]).join(", ")}.`,
        });
    }
    return problemas;
}
