import { Router, type Request, type Response } from "express";
import { testConnection } from "../../db/connection.ts";

export type VerificadorBanco = typeof testConnection;

/** 200 quando o banco responde; 503 quando a API está no ar mas o PostgreSQL não (mesmo corpo). */
export function criarHealthRouter(verificarBanco: VerificadorBanco = testConnection): Router {
    const router = Router();

    router.get("/", async (_req: Request, res: Response) => {
        const dbTest = await verificarBanco();
        res.status(dbTest.ok ? 200 : 503).json({
            status: dbTest.ok ? "ok" : "degradado",
            timestamp: new Date().toISOString(),
            database: {
                conectado: dbTest.ok,
                mensagem: dbTest.message,
            },
        });
    });

    return router;
}

export const healthRouter = criarHealthRouter();
