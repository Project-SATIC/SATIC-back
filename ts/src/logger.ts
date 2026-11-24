import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type NivelLog = "debug" | "info" | "warn" | "error" | "silent";

export interface ContextoRequisicao {
    requestId: string;
    autor: string;
    ip?: string;
    metodo?: string;
    caminho?: string;
    iniciadoEmMs: number;
}

export interface EntradaLogEstruturado {
    timestamp: string;
    level: Exclude<NivelLog, "silent">;
    service: "satic-back";
    msg: string;
    requestId?: string;
    autor?: string;
    [chave: string]: unknown;
}

const PESO_NIVEL: Record<NivelLog, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    silent: 100,
};

const storageContexto = new AsyncLocalStorage<ContextoRequisicao>();
const MAX_BUFFER_LOGS = 500;
const bufferLogs: EntradaLogEstruturado[] = [];
let sinkCustomizado: ((entrada: EntradaLogEstruturado) => void) | null = null;

const PADRAO_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Normaliza um X-Request-Id recebido ou gera um UUID v4 novo. */
export function normalizarRequestId(valor: unknown): string {
    if (typeof valor === "string") {
        const limpo = valor.trim();
        if (PADRAO_REQUEST_ID.test(limpo)) return limpo;
    }
    return randomUUID();
}

/** Normaliza o identificador do autor (X-Actor / X-User) ou usa 'sistema'. */
export function normalizarAutor(valor: unknown, fallback = "sistema"): string {
    if (typeof valor === "string") {
        const limpo = valor.trim().replace(/[\r\n\t]+/g, " ").slice(0, 120);
        if (limpo.length > 0) return limpo;
    }
    return fallback;
}

export function obterContextoRequisicao(): ContextoRequisicao | undefined {
    return storageContexto.getStore();
}

export function obterAutorAtual(): string {
    return storageContexto.getStore()?.autor ?? "sistema";
}

export function obterRequestIdAtual(): string | null {
    return storageContexto.getStore()?.requestId ?? null;
}

export function executarComContexto<T>(contexto: ContextoRequisicao, fn: () => T): T {
    return storageContexto.run(contexto, fn);
}

function nivelEfetivo(): NivelLog {
    const envNivel = (process.env.LOG_LEVEL ?? "").trim().toLowerCase() as NivelLog;
    if (envNivel in PESO_NIVEL) return envNivel;
    // Durante execução do runner node:test sem LOG_LEVEL explícito, evita poluir stdout com logs info
    if (process.env.NODE_TEST_CONTEXT) return "error";
    return "info";
}

export function definirSinkLogs(sink: ((entrada: EntradaLogEstruturado) => void) | null): void {
    sinkCustomizado = sink;
}

export function obterLogsRecentes(limite = 100): EntradaLogEstruturado[] {
    const n = Math.max(1, Math.min(limite, MAX_BUFFER_LOGS));
    return bufferLogs.slice(-n);
}

export function limparLogsRecentes(): void {
    bufferLogs.length = 0;
}

function registrar(
    level: Exclude<NivelLog, "silent">,
    msg: string,
    campos: Record<string, unknown> = {},
): EntradaLogEstruturado {
    const ctx = storageContexto.getStore();
    const entrada: EntradaLogEstruturado = {
        timestamp: new Date().toISOString(),
        level,
        service: "satic-back",
        msg,
        ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
        ...(ctx?.autor ? { autor: ctx.autor } : {}),
        ...campos,
    };

    if (bufferLogs.length >= MAX_BUFFER_LOGS) {
        bufferLogs.shift();
    }
    bufferLogs.push(entrada);

    if (sinkCustomizado) {
        sinkCustomizado(entrada);
    }

    if (PESO_NIVEL[level] >= PESO_NIVEL[nivelEfetivo()]) {
        const linha = JSON.stringify(entrada);
        if (level === "error" || level === "warn") {
            console.error(linha);
        } else {
            console.log(linha);
        }
    }

    return entrada;
}

export const logger = {
    debug: (msg: string, campos?: Record<string, unknown>) => registrar("debug", msg, campos),
    info: (msg: string, campos?: Record<string, unknown>) => registrar("info", msg, campos),
    warn: (msg: string, campos?: Record<string, unknown>) => registrar("warn", msg, campos),
    error: (msg: string, campos?: Record<string, unknown>) => registrar("error", msg, campos),
};

/**
 * Middleware Express que:
 * 1. Propaga ou gera `X-Request-Id` e o devolve no cabeçalho da resposta.
 * 2. Extrai o ator da operação (`X-Actor` ou `X-User`, fallback `"sistema"`).
 * 3. Armazena o contexto no `AsyncLocalStorage` para logs e auditoria transacional no PostgreSQL.
 * 4. Emite um log estruturado ao término da resposta HTTP com status e duração em ms.
 */
export function middlewareContextoELogs(req: Request, res: Response, next: NextFunction): void {
    const requestId = normalizarRequestId(req.header("x-request-id"));
    const autorHeader = req.header("x-actor") ?? req.header("x-user");
    const autor = normalizarAutor(autorHeader, "sistema");
    const iniciadoEmMs = performance.now();

    res.setHeader("X-Request-Id", requestId);

    const contexto: ContextoRequisicao = {
        requestId,
        autor,
        ip: req.ip || req.socket?.remoteAddress,
        metodo: req.method,
        caminho: req.originalUrl || req.url,
        iniciadoEmMs,
    };

    executarComContexto(contexto, () => {
        res.on("finish", () => {
            const durationMs = Number((performance.now() - iniciadoEmMs).toFixed(2));
            const status = res.statusCode;
            const nivel: Exclude<NivelLog, "silent"> =
                status >= 500 ? "error" : status >= 400 ? "warn" : "info";
            registrar(nivel, "http_request", {
                method: req.method,
                path: req.originalUrl || req.url,
                status,
                durationMs,
            });
        });
        next();
    });
}
