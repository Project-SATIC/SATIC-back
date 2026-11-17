/**
 * Parser da notação de horários do SIGAA/UFAL (porte de service/SigaaHorarioParser.java).
 *
 * Converte expressões simples ou compostas ("35M34", "2T56 6T12", "2345M3456", "7M45", "4N1234")
 * em slots atômicos "DIA-TURNO+HORA" (ex: "TER-M3").
 */
import type { DiaSemana, IndisponibilidadeDocente, Turno } from "./tipos.ts";

const BLOCK_PATTERN = /^([2-7]+)([MTN])([1-6]+)$/;

export const DIAS_SIGAA: Readonly<Record<string, DiaSemana>> = Object.freeze({
    "2": "SEG", "3": "TER", "4": "QUA", "5": "QUI", "6": "SEX", "7": "SAB",
});

export const TURNOS: readonly Turno[] = Object.freeze(["M", "T", "N"]);

const CACHE_SLOTS = new Map<string, ReadonlySet<string>>();
const VAZIO: ReadonlySet<string> = Object.freeze(new Set<string>());

export function diaDoCodigoSigaa(codigo: string): DiaSemana {
    const dia = DIAS_SIGAA[codigo];
    if (!dia) throw new Error(`Código de dia SIGAA inválido: ${codigo}`);
    return dia;
}

/** Conjunto (com cache, na ordem de expansão) dos slots atômicos de um horário SIGAA. */
export function obterConjuntoSlots(horarioSigaa: string | null | undefined): ReadonlySet<string> {
    if (horarioSigaa == null || horarioSigaa.trim() === "") return VAZIO;
    const chave = horarioSigaa.trim().toUpperCase();
    const emCache = CACHE_SLOTS.get(chave);
    if (emCache) return emCache;

    const slots = new Set<string>();
    for (const token of chave.split(/\s+/)) {
        const m = BLOCK_PATTERN.exec(token);
        if (!m) {
            throw new FormatoHorarioInvalidoError(`Formato de horário SIGAA não reconhecido: '${token}' em '${horarioSigaa}'`);
        }
        const [, dias, turno, horas] = m;
        for (const d of dias) {
            const dia = diaDoCodigoSigaa(d);
            for (const h of horas) slots.add(`${dia}-${turno}${h}`);
        }
    }
    const congelado: ReadonlySet<string> = Object.freeze(slots);
    CACHE_SLOTS.set(chave, congelado);
    return congelado;
}

export function expandirParaSlotsAtomicos(horarioSigaa: string | null | undefined): string[] {
    return [...obterConjuntoSlots(horarioSigaa)];
}

/** true se as duas expressões têm ao menos um slot atômico em comum. */
export function haSobreposicao(horarioA: string | null | undefined, horarioB: string | null | undefined): boolean {
    if (horarioA == null || horarioB == null) return false;
    const slotsA = obterConjuntoSlots(horarioA);
    const slotsB = obterConjuntoSlots(horarioB);
    for (const slot of slotsA) {
        if (slotsB.has(slot)) return true;
    }
    return false;
}

/** Expande uma indisponibilidade docente para slots atômicos (IndisponibilidadeDocente.toSlotsAtomicos). */
export function slotsDaIndisponibilidade(ind: IndisponibilidadeDocente): string[] {
    if (ind.diaSemana == null || ind.turno == null || ind.indiceHorario == null) return [];
    let dia = ind.diaSemana.trim().toUpperCase();
    if (dia.length === 1 && dia >= "0" && dia <= "9") dia = diaDoCodigoSigaa(dia);
    const turno = ind.turno.trim().toUpperCase();
    const slots: string[] = [];
    for (const c of ind.indiceHorario.trim()) {
        if (c >= "0" && c <= "9") slots.push(`${dia}-${turno}${c}`);
    }
    return slots;
}

export class FormatoHorarioInvalidoError extends Error {
    constructor(mensagem: string) {
        super(mensagem);
        this.name = "FormatoHorarioInvalidoError";
    }
}
