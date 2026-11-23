import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

export function formatarErro(err: unknown): string {
    if (err instanceof AggregateError && err.errors.length > 0) {
        const inner = err.errors
            .map((e: unknown) => formatarErro(e))
            .filter((m) => m !== "")
            .join("; ");
        return inner || err.message || "Falha de conexão (AggregateError)";
    }
    if (err instanceof Error) {
        const code = (err as { code?: string }).code;
        return err.message || code || err.name || "Erro desconhecido";
    }
    return String(err);
}

function createPoolConfig(): pg.PoolConfig {
    const basePoolOptions = {
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    };

    if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== "") {
        return {
            connectionString: process.env.DATABASE_URL,
            ...basePoolOptions,
        };
    }

    return {
        host: process.env.PGHOST || "localhost",
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || "postgres",
        password: process.env.PGPASSWORD || "postgres",
        database: process.env.PGDATABASE || "satic",
        ...basePoolOptions,
    };
}

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
    if (!pool) {
        pool = new Pool(createPoolConfig());
        pool.on("error", (err) => {
            console.error("[PostgreSQL] Erro inesperado no cliente do pool:", err.message);
        });
    }
    return pool;
}

export interface QueryExecutor {
    query<R extends pg.QueryResultRow = pg.QueryResultRow>(
        text: string,
        params?: unknown[]
    ): Promise<pg.QueryResult<R>>;
}

export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[]
): Promise<pg.QueryResult<R>> {
    const currentPool = getPool();
    return currentPool.query<R>(text, params);
}

export async function executarQuery<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
    executor?: QueryExecutor
): Promise<pg.QueryResult<R>> {
    if (executor) {
        return executor.query<R>(text, params);
    }
    return query<R>(text, params);
}

export async function getClient(): Promise<pg.PoolClient> {
    const currentPool = getPool();
    return currentPool.connect();
}

export async function comTransacao<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await getClient();
    let transacaoIniciada = false;
    let descartarCliente = false;
    try {
        await client.query("BEGIN;");
        transacaoIniciada = true;
        const resultado = await fn(client);
        await client.query("COMMIT;");
        return resultado;
    } catch (err) {
        if (transacaoIniciada) {
            try {
                await client.query("ROLLBACK;");
            } catch {
                descartarCliente = true;
            }
        } else {
            descartarCliente = true;
        }
        throw err;
    } finally {
        client.release(descartarCliente ? true : undefined);
    }
}

export async function testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
        const res = await query("SELECT current_database() AS db, version() AS ver;");
        return { ok: true, message: `Conectado ao banco '${res.rows[0].db}'` };
    } catch (err: unknown) {
        return { ok: false, message: formatarErro(err) };
    }
}

export async function closePool(): Promise<void> {
    if (pool) {
        await pool.end();
        pool = null;
    }
}
