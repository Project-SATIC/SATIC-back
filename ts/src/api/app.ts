import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { formatarErro } from "../db/connection.ts";
import { healthRouter } from "./routes/health.routes.ts";
import { disciplinasRouter } from "./routes/disciplinas.routes.ts";
import { salasRouter } from "./routes/salas.routes.ts";
import { professoresRouter } from "./routes/professores.routes.ts";
import { turmasRouter } from "./routes/turmas.routes.ts";
import { alocacoesRouter } from "./routes/alocacoes.routes.ts";

export function criarApp(): Express {
    const app = express();

    app.use(cors());
    app.use(express.json());

    // Rotas da API
    app.use("/api/health", healthRouter);
    app.use("/api/disciplinas", disciplinasRouter);
    app.use("/api/salas", salasRouter);
    app.use("/api/professores", professoresRouter);
    app.use("/api/turmas", turmasRouter);
    app.use("/api/alocacoes", alocacoesRouter);

    // Rota raiz informativa
    app.get("/", (_req: Request, res: Response) => {
        res.json({
            nome: "SATIC API (Sistema de Alocação de Turmas - IC UFAL)",
            versao: "0.1.0",
            status: "online",
            documentacao: {
                rotas: [
                    "/api/health",
                    "/api/disciplinas",
                    "/api/salas",
                    "/api/professores",
                    "/api/turmas",
                    "/api/alocacoes",
                ],
            },
        });
    });

    // Tratamento de rota não encontrada (404)
    app.use((req: Request, res: Response) => {
        res.status(404).json({ erro: `Rota ${req.method} ${req.path} não encontrada` });
    });

    // Handler global de erros (preserva 4xx do parser Express, ex: JSON malformado 400 e payload grande 413)
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        const msg = formatarErro(err);
        const httpErr = err as { status?: number; statusCode?: number; type?: string } | undefined;
        const status = httpErr?.status ?? httpErr?.statusCode;

        if (typeof status === "number" && status >= 400 && status < 500) {
            const erroMsg =
                httpErr?.type === "entity.parse.failed"
                    ? "JSON inválido no corpo da requisição"
                    : httpErr?.type === "entity.too.large"
                        ? "Corpo da requisição excede o tamanho máximo permitido"
                        : "Requisição inválida";
            res.status(status).json({ erro: erroMsg, detalhes: msg });
            return;
        }

        console.error("[SATIC-API] Erro não tratado:", msg);
        res.status(500).json({ erro: "Erro interno no servidor", detalhes: msg });
    });

    return app;
}
