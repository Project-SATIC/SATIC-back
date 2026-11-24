import "dotenv/config";
import { criarApp } from "./app.ts";
import { closePool, testConnection } from "../db/connection.ts";

const PORT = Number(process.env.PORT || 3001);
const app = criarApp();

async function startServer(): Promise<void> {
    console.log("[SATIC-SERVER] Iniciando servidor Express...");
    const conn = await testConnection();
    if (conn.ok) {
        console.log(`[SATIC-SERVER] PostgreSQL: ${conn.message}`);
    } else {
        console.warn(`[SATIC-SERVER] AVISO PostgreSQL: ${conn.message}`);
        console.warn("[SATIC-SERVER] O servidor responderá requisições, mas operações de banco exigirão PostgreSQL ativo.");
    }

    const server = app.listen(PORT, () => {
        console.log(`[SATIC-SERVER] Servidor rodando em http://localhost:${PORT}`);
        console.log(`[SATIC-SERVER] Health check: http://localhost:${PORT}/api/health`);
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
        const motivo = err.code === "EADDRINUSE" ? `porta ${PORT} já está em uso (defina PORT no .env)` : err.message;
        console.error(`[SATIC-SERVER] Não foi possível iniciar: ${motivo}`);
        process.exit(1);
    });

    // Encerramento limpo: para de aceitar conexões e fecha o pool do PostgreSQL
    let encerrando = false;
    const encerrar = (sinal: string) => {
        if (encerrando) return;
        encerrando = true;
        console.log(`[SATIC-SERVER] ${sinal} recebido, encerrando...`);
        server.close(() => {
            closePool().finally(() => process.exit(0));
        });
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on("SIGINT", () => encerrar("SIGINT"));
    process.on("SIGTERM", () => encerrar("SIGTERM"));
}

startServer();
