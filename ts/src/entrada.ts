/**
 * Leitura e validação dos valores que chegam do cliente (params, query e body).
 * Cada função devolve o valor normalizado ou lança ErroRequisicao (HTTP 400).
 */
import { ErroRequisicao } from "./erros.ts";
import { FormatoHorarioInvalidoError, obterConjuntoSlots } from "./shared/horario-sigaa.ts";
import type { StatusAlocacao } from "./shared/tipos.ts";

export const STATUS_ALOCACAO: readonly StatusAlocacao[] = Object.freeze(["RASCUNHO", "DEFINITIVA", "EXTERNA_FIXA"]);

const SEMESTRE_PATTERN = /^\d{4}\.[12]$/;
const MAX_INT4 = 2_147_483_647;

/** Inteiro positivo de 32 bits (aceita número ou string numérica, ex: "12"). */
export function lerId(valor: unknown, campo: string): number {
    const n = typeof valor === "string" && valor.trim() !== "" ? Number(valor) : valor;
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0 || n > MAX_INT4) {
        throw new ErroRequisicao(`${campo} é obrigatório e deve ser um inteiro positivo válido`);
    }
    return n;
}

/** Semestre opcional em query string: vazio/ausente -> undefined; repetido (?semestre=a&semestre=b) -> 400. */
export function lerSemestreOpcionalQuery(valor: unknown): string | undefined {
    if (valor === undefined) return undefined;
    if (typeof valor === "string" && valor.trim() === "") return undefined;
    return lerSemestre(valor);
}

/** Texto opcional em query string: rejeita parâmetros repetidos (array) com 400. */
export function lerTextoOpcionalQuery(valor: unknown, campo: string): string | undefined {
    if (valor === undefined) return undefined;
    if (typeof valor !== "string") throw new ErroRequisicao(`${campo} deve ser um texto único`);
    const limpo = valor.trim();
    return limpo === "" ? undefined : limpo;
}

/** Semestre no formato AAAA.S (ex: "2026.2"). */
export function lerSemestre(valor: unknown, padrao?: string): string {
    if (valor == null || (typeof valor === "string" && valor.trim() === "")) {
        if (padrao != null) return padrao;
        throw new ErroRequisicao("semestre é obrigatório");
    }
    if (typeof valor !== "string" || !SEMESTRE_PATTERN.test(valor.trim())) {
        throw new ErroRequisicao(`semestre inválido: use o formato AAAA.S (ex: "2026.2")`);
    }
    return valor.trim();
}

/** Horário SIGAA opcional. Devolve undefined quando ausente ou vazio; lança 400 se não for reconhecido. */
export function lerHorarioOpcional(valor: unknown): string | undefined {
    if (valor == null || (typeof valor === "string" && valor.trim() === "")) return undefined;
    if (typeof valor !== "string") throw new ErroRequisicao("horario deve ser uma string no formato SIGAA (ex: \"35T34\")");
    const horario = valor.trim().toUpperCase().replace(/\s+/g, " ");
    if (horario.length > 120) throw new ErroRequisicao("horario muito longo (máximo 120 caracteres)");
    try {
        obterConjuntoSlots(horario);
    } catch (err) {
        if (err instanceof FormatoHorarioInvalidoError) throw new ErroRequisicao(`horario inválido: ${err.message}`);
        throw err;
    }
    return horario;
}

export function lerStatusOpcional(valor: unknown): StatusAlocacao | undefined {
    if (valor == null || valor === "") return undefined;
    if (typeof valor !== "string" || !STATUS_ALOCACAO.includes(valor as StatusAlocacao)) {
        throw new ErroRequisicao(`status inválido: use um de ${STATUS_ALOCACAO.join(", ")}`);
    }
    return valor as StatusAlocacao;
}

export function lerBooleanoOpcional(valor: unknown, campo: string): boolean | undefined {
    if (valor == null) return undefined;
    if (typeof valor === "boolean") return valor;
    if (valor === "true" || valor === "1") return true;
    if (valor === "false" || valor === "0") return false;
    throw new ErroRequisicao(`${campo} deve ser booleano`);
}

export function lerInteiroOpcional(valor: unknown, campo: string, min: number, max: number): number | undefined {
    if (valor == null) return undefined;
    if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor < min || valor > max) {
        throw new ErroRequisicao(`${campo} deve ser um inteiro entre ${min} e ${max}`);
    }
    return valor;
}

export function lerListaDeTextosOpcional(valor: unknown, campo: string): string[] | undefined {
    if (valor == null) return undefined;
    if (!Array.isArray(valor) || !valor.every((v) => typeof v === "string")) {
        throw new ErroRequisicao(`${campo} deve ser uma lista de strings`);
    }
    return valor.map((v) => v.trim()).filter((v) => v !== "");
}

/** Lista opcional de ids inteiros positivos (ex.: turmas-alvo do motor). */
export function lerListaDeIdsOpcional(valor: unknown, campo: string): number[] | undefined {
    if (valor == null) return undefined;
    if (!Array.isArray(valor)) throw new ErroRequisicao(`${campo} deve ser uma lista de ids`);
    return valor.map((v, i) => lerId(v, `${campo}[${i}]`));
}

/** Corpo JSON como objeto (rejeita arrays e valores primitivos). */
export function lerCorpo(body: unknown): Record<string, unknown> {
    if (body == null) return {};
    if (typeof body !== "object" || Array.isArray(body)) {
        throw new ErroRequisicao("o corpo da requisição deve ser um objeto JSON");
    }
    return body as Record<string, unknown>;
}

/** Texto obrigatório não vazio no corpo JSON. */
export function lerTextoObrigatorio(valor: unknown, campo: string, maxLen = 255): string {
    if (typeof valor !== "string" || valor.trim() === "") {
        throw new ErroRequisicao(`${campo} é obrigatório e deve ser um texto não vazio`);
    }
    const limpo = valor.trim();
    if (limpo.length > maxLen) {
        throw new ErroRequisicao(`${campo} muito longo (máximo ${maxLen} caracteres)`);
    }
    return limpo;
}

/** Texto opcional no corpo JSON: undefined quando ausente; erro 400 se vazio ou tipo inválido. */
export function lerTextoOpcionalCorpo(valor: unknown, campo: string, maxLen = 255): string | undefined {
    if (valor === undefined) return undefined;
    return lerTextoObrigatorio(valor, campo, maxLen);
}

/** Inteiro obrigatório dentro de [min, max]. */
export function lerInteiroObrigatorio(valor: unknown, campo: string, min: number, max = MAX_INT4): number {
    if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor < min || valor > max) {
        throw new ErroRequisicao(`${campo} é obrigatório e deve ser um inteiro entre ${min} e ${max}`);
    }
    return valor;
}

/** Lista de docentes (strings SIAPE ou `{ matriculaSiape, cargaHoraria? }`). */
export function lerVinculosDocentesOpcional(
    valor: unknown,
    campo: string,
): Array<{ matriculaSiape: string; cargaHoraria?: number }> | undefined {
    if (valor === undefined) return undefined;
    if (!Array.isArray(valor)) {
        throw new ErroRequisicao(`${campo} deve ser uma lista de matrículas SIAPE ou objetos { matriculaSiape, cargaHoraria? }`);
    }
    const vistos = new Set<string>();
    const resultado: Array<{ matriculaSiape: string; cargaHoraria?: number }> = [];
    for (let i = 0; i < valor.length; i++) {
        const item = valor[i];
        let siape: string;
        let cargaHoraria: number | undefined;
        if (typeof item === "string") {
            siape = lerTextoObrigatorio(item, `${campo}[${i}]`, 50);
        } else if (item && typeof item === "object" && !Array.isArray(item)) {
            const obj = item as Record<string, unknown>;
            siape = lerTextoObrigatorio(obj.matriculaSiape, `${campo}[${i}].matriculaSiape`, 50);
            cargaHoraria = lerInteiroOpcional(obj.cargaHoraria, `${campo}[${i}].cargaHoraria`, 0, 1000);
        } else {
            throw new ErroRequisicao(`${campo}[${i}] deve ser uma string SIAPE ou objeto { matriculaSiape, cargaHoraria? }`);
        }
        if (!vistos.has(siape)) {
            vistos.add(siape);
            resultado.push(cargaHoraria !== undefined ? { matriculaSiape: siape, cargaHoraria } : { matriculaSiape: siape });
        }
    }
    return resultado;
}
