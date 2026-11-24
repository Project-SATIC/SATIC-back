import "dotenv/config";
import { criarApp } from "./app.ts";
import { closePool, query, testConnection } from "../db/connection.ts";
import { executarMigrations } from "../db/migrator.ts";
import { logger } from "../logger.ts";
import { AlocadorService } from "../motor/alocador.service.ts";
import { executarSeed } from "../seed/db-seeder.ts";

const PORT = Number(process.env.PORT || 3001);
const app = criarApp();

async function inicializarBancoSeConfigurado(): Promise<void> {
    if (process.env.AUTO_MIGRATE === "true") {
        logger.info("Executando migrations automáticas (AUTO_MIGRATE=true)...");
        await executarMigrations();
    }
    if (process.env.AUTO_SEED === "true") {
        const res = await query<{ total: string }>("SELECT COUNT(*)::text AS total FROM turma;");
        if (Number(res.rows[0]?.total ?? 0) === 0) {
            logger.info("Banco vazio detectado (AUTO_SEED=true). Populando seed 2026.2 e gerando grade inicial...");
            await executarSeed();
            await new AlocadorService().gerarAlocacao({ semestre: "2026.2", persistir: true });
        }
    }
}

async function startServer(): Promise<void> {
    logger.info("Iniciando servidor Express SATIC-back...");
    const conn = await testConnection();
    if (conn.ok) {
        logger.info("Conexão com PostgreSQL estabelecida", { detalhe: conn.message });
        await inicializarBancoSeConfigurado();
    } else {
        logger.warn("PostgreSQL indisponível na inicialização", { detalhe: conn.message });
    }

    const server = app.listen(PORT, () => {
        logger.info("Servidor HTTP pronto", {
            porta: PORT,
            url: `http://localhost:${PORT}`,
            healthCheck: `http://localhost:${PORT}/api/health`,
        });
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
        const motivo = err.code === "EADDRINUSE" ? `porta ${PORT} já está em uso (defina PORT no .env)` : err.message;
        logger.error("Não foi possível iniciar o servidor HTTP", { motivo, codigo: err.code });
        process.exit(1);
    });

    // Encerramento limpo: para de aceitar conexões e fecha o pool do PostgreSQL
    let encerrando = false;
    const encerrar = (sinal: string) => {
        if (encerrando) return;
        encerrando = true;
        logger.info("Sinal de encerramento recebido", { sinal });
        server.close(() => {
            closePool().finally(() => process.exit(0));
        });
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on("SIGINT", () => encerrar("SIGINT"));
    process.on("SIGTERM", () => encerrar("SIGTERM"));
}

startServer();
