import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { logger, obterContextoRequisicao } from "../logger.ts";

const { Pool } = pg;
const storageTransacao = new AsyncLocalStorage<Executor>();

function createPoolConfig(): pg.PoolConfig {
    // PGPOOL_MAX: tamanho do pool (padrão 10). Os testes usam 1 porque o PGlite tem uma única sessão.
    const comuns: pg.PoolConfig = {
        max: Number(process.env.PGPOOL_MAX || 10),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    };

    if (process.env.DATABASE_URL) {
        return { ...comuns, connectionString: process.env.DATABASE_URL };
    }

    return {
        ...comuns,
        host: process.env.PGHOST || "localhost",
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || "postgres",
        password: process.env.PGPASSWORD || "postgres",
        database: process.env.PGDATABASE || "satic",
    };
}

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
    if (!pool) {
        pool = new Pool(createPoolConfig());
        pool.on("error", (err) => {
            logger.error("Erro inesperado no cliente do pool PostgreSQL", { erro: err.message });
        });
    }
    return pool;
}

const REGEX_ESCRITA_SQL = /^\s*(INSERT|UPDATE|DELETE)\b/i;

export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[]
): Promise<pg.QueryResult<R>> {
    const txAtiva = storageTransacao.getStore();
    if (txAtiva) {
        return txAtiva.query<R>(text, params);
    }
    const ctx = obterContextoRequisicao();
    if (ctx && REGEX_ESCRITA_SQL.test(text)) {
        return comTransacao((db) => db.query<R>(text, params));
    }
    const currentPool = getPool();
    return currentPool.query<R>(text, params);
}

export async function getClient(): Promise<pg.PoolClient> {
    const currentPool = getPool();
    return currentPool.connect();
}

/**
 * Qualquer objeto capaz de executar SQL: o pool (padrão) ou um cliente dentro de uma transação.
 * Os repositórios recebem um Executor opcional para participar de transações abertas pelos serviços.
 */
export interface Executor {
    query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<R>>;
}

export const executorPadrao: Executor = { query };

/** Abre uma transação, executa `fn` com o cliente dela e faz COMMIT (ou ROLLBACK em caso de erro). */
export type ExecutorTransacional = <T>(fn: (db: Executor) => Promise<T>) => Promise<T>;

/** Executa `fn` dentro de BEGIN/COMMIT, com ROLLBACK em caso de erro. Reutiliza a transação ativa se chamado de forma aninhada. */
export async function comTransacao<T>(fn: (db: Executor) => Promise<T>): Promise<T> {
    const txAtiva = storageTransacao.getStore();
    if (txAtiva) {
        return fn(txAtiva);
    }
    const client = await getClient();
    let conexaoQuebrada = false;
    try {
        await client.query("BEGIN;");
        const ctx = obterContextoRequisicao();
        if (ctx) {
            await client.query(
                "SELECT set_config('satic.autor', $1, true), set_config('satic.request_id', $2, true);",
                [ctx.autor, ctx.requestId],
            );
        }
        const execCliente = client as Executor;
        const resultado = await storageTransacao.run(execCliente, () => fn(execCliente));
        await client.query("COMMIT;");
        return resultado;
    } catch (err) {
        await client.query("ROLLBACK;").catch(() => {
            conexaoQuebrada = true;
        });
        throw err;
    } finally {
        // Conexão que nem o ROLLBACK aceita é descartada em vez de voltar ao pool
        client.release(conexaoQuebrada);
    }
}

export const SQL_LOCK_SEMESTRE = "SELECT pg_advisory_xact_lock(hashtext($1));";

/**
 * Serializa, dentro da transação atual, as escritas de alocação de um semestre: geração (`/gerar`)
 * e remanejamentos (`/confirmar`) do mesmo semestre nunca rodam em paralelo, inclusive entre
 * processos diferentes da API. O lock é liberado sozinho no COMMIT/ROLLBACK.
 * Leituras feitas depois do lock já enxergam o que a transação concorrente gravou (READ COMMITTED).
 */
export async function bloquearSemestre(db: Executor, semestre: string): Promise<void> {
    await db.query(SQL_LOCK_SEMESTRE, [`satic:alocacao:${semestre}`]);
}

export async function testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
        const res = await query("SELECT current_database() AS db, version() AS ver;");
        return { ok: true, message: `Conectado ao banco '${res.rows[0].db}'` };
    } catch (err: unknown) {
        if (err instanceof AggregateError && err.errors.length > 0) {
            const inner = err.errors.map((e: unknown) => (e instanceof Error ? e.message : String(e))).join("; ");
            return { ok: false, message: inner || err.message || "Falha na conexão de rede (ECONNREFUSED)" };
        }
        const errorMsg = err instanceof Error ? (err.message || (err as { code?: string }).code || "Falha de conexão") : String(err);
        return { ok: false, message: errorMsg };
    }
}

export async function closePool(): Promise<void> {
    if (pool) {
        await pool.end();
        pool = null;
    }
}
