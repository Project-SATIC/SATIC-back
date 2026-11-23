export const MAX_PG_INT4 = 2147483647;

export function extrairParamString(valor: string | string[] | undefined): string {
    if (Array.isArray(valor)) {
        return valor[0] ?? "";
    }
    return typeof valor === "string" ? valor : "";
}

export function parseIdParam(valor: string | string[] | undefined): number | null {
    const bruto = extrairParamString(valor).trim();
    if (!/^\d+$/.test(bruto)) return null;
    const num = Number(bruto);
    if (!Number.isSafeInteger(num) || num <= 0 || num > MAX_PG_INT4) return null;
    return num;
}

export function parseInteiroPositivoEstrito(valor: unknown): number | null {
    if (typeof valor !== "number" || !Number.isInteger(valor)) return null;
    if (valor <= 0 || valor > MAX_PG_INT4) return null;
    return valor;
}

export function parseInteiroNaoNegativoEstrito(valor: unknown): number | null {
    if (typeof valor !== "number" || !Number.isInteger(valor)) return null;
    if (valor < 0 || valor > MAX_PG_INT4) return null;
    return valor;
}

export function parseBooleanoEstrito(valor: unknown): boolean | null {
    return typeof valor === "boolean" ? valor : null;
}

export function parseQueryBooleano(
    valor: unknown
): { definido: false } | { definido: true; valor: boolean } | { definido: true; invalido: true } {
    if (valor === undefined) {
        return { definido: false };
    }
    if (typeof valor !== "string") {
        return { definido: true, invalido: true };
    }
    const norm = valor.trim().toLowerCase();
    if (norm === "") {
        return { definido: false };
    }
    if (norm === "true" || norm === "1") {
        return { definido: true, valor: true };
    }
    if (norm === "false" || norm === "0") {
        return { definido: true, valor: false };
    }
    return { definido: true, invalido: true };
}
