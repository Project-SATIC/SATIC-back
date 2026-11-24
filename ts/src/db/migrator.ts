import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { comTransacao, query } from "./connection.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations");

export interface MigrationResult {
    arquivo: string;
    status: "aplicada" | "ja_executada" | "erro";
    mensagem?: string;
}

export async function inicializarTabelaMigrations(): Promise<void> {
    await query(`
        CREATE TABLE IF NOT EXISTS _migrations (
            id SERIAL PRIMARY KEY,
            nome VARCHAR(255) NOT NULL UNIQUE,
            executado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

export async function listarMigrationsExecutadas(): Promise<Set<string>> {
    await inicializarTabelaMigrations();
    const res = await query<{ nome: string }>("SELECT nome FROM _migrations ORDER BY id ASC;");
    return new Set(res.rows.map((r) => r.nome));
}

export async function executarMigrations(): Promise<MigrationResult[]> {
    await inicializarTabelaMigrations();
    const executadas = await listarMigrationsExecutadas();

    const arquivos = await fs.readdir(MIGRATIONS_DIR);
    const sqlArquivos = arquivos
        .filter((f) => f.endsWith(".sql"))
        .sort((a, b) => a.localeCompare(b));

    const resultados: MigrationResult[] = [];

    for (const arquivo of sqlArquivos) {
        if (executadas.has(arquivo)) {
            resultados.push({ arquivo, status: "ja_executada" });
            continue;
        }

        const caminhoArquivo = path.join(MIGRATIONS_DIR, arquivo);
        const conteudoSql = await fs.readFile(caminhoArquivo, "utf-8");

        try {
            await comTransacao(async (db) => {
                await db.query(conteudoSql);
                await db.query("INSERT INTO _migrations (nome) VALUES ($1);", [arquivo]);
            });

            resultados.push({ arquivo, status: "aplicada" });
            console.log(`[Migrations] Aplicada com sucesso: ${arquivo}`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[Migrations] Falha ao aplicar ${arquivo}:`, msg);
            resultados.push({ arquivo, status: "erro", mensagem: msg });
            throw new Error(`Erro na migration ${arquivo}: ${msg}`);
        }
    }

    return resultados;
}

export async function resetarBanco(): Promise<void> {
    console.log("[Migrations] Limpando todas as tabelas e funções do SATIC...");
    await query(`
        DROP TABLE IF EXISTS alocacao CASCADE;
        DROP TABLE IF EXISTS professor_turma CASCADE;
        DROP TABLE IF EXISTS restricoes_horario CASCADE;
        DROP TABLE IF EXISTS turma CASCADE;
        DROP TABLE IF EXISTS disciplina CASCADE;
        DROP TABLE IF EXISTS sala CASCADE;
        DROP TABLE IF EXISTS professor CASCADE;
        DROP TABLE IF EXISTS _migrations CASCADE;
        DROP FUNCTION IF EXISTS satic_atualizar_alocacao_timestamp() CASCADE;
    `);
    console.log("[Migrations] Banco resetado.");
}
