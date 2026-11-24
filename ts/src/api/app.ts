import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors, { type CorsOptions } from "cors";
import { criarHealthRouter, type VerificadorBanco } from "./routes/health.routes.ts";
import { criarDisciplinasRouter, type RepoDisciplinasRota } from "./routes/disciplinas.routes.ts";
import { criarSalasRouter, type RepoSalasRota } from "./routes/salas.routes.ts";
import { criarProfessoresRouter, type RepoProfessoresRota } from "./routes/professores.routes.ts";
import { criarTurmasRouter, type RepoTurmasRota } from "./routes/turmas.routes.ts";
import { criarAlocacoesRouter, type ServicosAlocacao } from "./routes/alocacoes.routes.ts";
import { sharedRouter } from "./routes/shared.routes.ts";
import { ErroHttp } from "../erros.ts";
import { FormatoHorarioInvalidoError } from "../shared/horario-sigaa.ts";

export interface OpcoesApp {
    /** Substitui serviços/repositórios nos testes para não depender do PostgreSQL. */
    alocacoes?: Partial<ServicosAlocacao>;
    turmasRepo?: RepoTurmasRota;
    salasRepo?: RepoSalasRota;
    disciplinasRepo?: RepoDisciplinasRota;
    professoresRepo?: RepoProfessoresRota;
    testConnection?: VerificadorBanco;
}

/**
 * CORS_ORIGIN="http://127.0.0.1:8040,http://localhost:8040" restringe as origens aceitas.
 * Sem a variável, qualquer origem é aceita (desenvolvimento local).
 */
function opcoesCors(): CorsOptions {
    const origens = (process.env.CORS_ORIGIN ?? "").split(",").map((o) => o.trim()).filter(Boolean);
    return origens.length > 0 ? { origin: origens } : {};
}

const CODIGOS_BANCO_INDISPONIVEL = new Set([
    "ECONNREFUSED", "EACCES", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN",
    "57P01", "57P02", "57P03", // admin_shutdown, crash_shutdown, cannot_connect_now
    "3D000", // banco inexistente
    "28P01", "28000", // falha de autenticação
]);

/** Erro de conexão com o PostgreSQL (servidor fora do ar, credenciais erradas, banco inexistente). */
function isBancoIndisponivel(err: unknown): boolean {
    if (err instanceof AggregateError) return err.errors.some(isBancoIndisponivel);
    if (typeof err !== "object" || err === null) return false;
    const codigo = (err as { code?: unknown }).code;
    if (typeof codigo === "string" && CODIGOS_BANCO_INDISPONIVEL.has(codigo)) return true;
    const msg = err instanceof Error ? err.message : "";
    return /timeout exceeded when trying to connect|Connection terminated/i.test(msg);
}

/** Violação de integridade do PostgreSQL: 23505 (unique), 23503 (foreign key) e 23514 (check). */
function codigoIntegridade(err: unknown): string | undefined {
    const codigo = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
    return codigo === "23505" || codigo === "23503" || codigo === "23514" ? codigo : undefined;
}

/** Dados incompatíveis com tipos/tamanhos das colunas do PostgreSQL: 22001, 22003, 22P02, 23502. */
function codigoDadosInvalidos(err: unknown): string | undefined {
    const codigo = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
    return codigo === "22001" || codigo === "22003" || codigo === "22P02" || codigo === "23502" ? codigo : undefined;
}

function mensagemDe(err: unknown): string {
    if (err instanceof AggregateError && err.errors.length > 0) return err.errors.map(mensagemDe).join("; ");
    if (err instanceof Error) return err.message || (err as { code?: string }).code || err.name;
    return String(err);
}

/** Erro de JSON malformado gerado pelo body-parser do express.json(). */
function isErroDeCorpo(err: unknown): err is { status: number; type: string; message: string } {
    return typeof err === "object" && err !== null && "type" in err && "status" in err
        && typeof (err as { status: unknown }).status === "number";
}

export function criarApp(opcoes: OpcoesApp = {}): Express {
    const app = express();

    app.use(cors(opcoesCors()));
    app.use(express.json({ limit: "1mb" }));

    // Rotas da API
    app.use("/api/health", criarHealthRouter(opcoes.testConnection));
    app.use("/api/disciplinas", criarDisciplinasRouter(opcoes.disciplinasRepo));
    app.use("/api/salas", criarSalasRouter(opcoes.salasRepo));
    app.use("/api/professores", criarProfessoresRouter(opcoes.professoresRepo));
    app.use("/api/turmas", criarTurmasRouter(opcoes.turmasRepo));
    app.use("/api/alocacoes", criarAlocacoesRouter(opcoes.alocacoes));

    // Parser SIGAA e validador compartilhados com o front (módulos ES)
    app.use("/shared", sharedRouter);

    // Rota raiz informativa
    app.get("/", (_req: Request, res: Response) => {
        res.json({
            nome: "SATIC API (Sistema de Alocação de Turmas - IC UFAL)",
            versao: "0.2.0",
            status: "online",
            documentacao: {
                rotas: [
                    "/api/health",
                    "/api/disciplinas",
                    "/api/salas",
                    "/api/professores",
                    "/api/turmas",
                    "/api/alocacoes",
                    "/shared/grade.js",
                    "/shared/validador.js",
                    "/shared/horario-sigaa.js",
                    "/shared/tipos.js",
                ],
            },
        });
    });

    // Tratamento de rota não encontrada (404)
    app.use((req: Request, res: Response) => {
        res.status(404).json({ erro: `Rota ${req.method} ${req.path} não encontrada` });
    });

    // Handler global de erros: ErroHttp -> seu status; JSON inválido -> 400; resto -> 500
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        if (err instanceof ErroHttp) {
            res.status(err.status).json({ erro: err.message, ...(err.detalhes !== undefined ? { detalhes: err.detalhes } : {}) });
            return;
        }
        if (err instanceof FormatoHorarioInvalidoError) {
            res.status(400).json({ erro: "Horário SIGAA inválido", detalhes: err.message });
            return;
        }
        if (isErroDeCorpo(err) && err.status >= 400 && err.status < 500) {
            res.status(err.status).json({ erro: "Corpo da requisição inválido", detalhes: err.message });
            return;
        }
        const emProducao = process.env.NODE_ENV === "production";
        if (isBancoIndisponivel(err)) {
            console.error("[SATIC-API] PostgreSQL indisponível:", mensagemDe(err));
            res.status(503).json(emProducao ? { erro: "Banco de dados indisponível" } : { erro: "Banco de dados indisponível", detalhes: mensagemDe(err) });
            return;
        }
        if (codigoIntegridade(err)) {
            res.status(409).json({ erro: "Operação viola a integridade do banco", detalhes: mensagemDe(err) });
            return;
        }
        if (codigoDadosInvalidos(err)) {
            res.status(400).json({ erro: "Dados inválidos para o banco de dados", detalhes: mensagemDe(err) });
            return;
        }
        console.error("[SATIC-API] Erro não tratado:", err);
        res.status(500).json(emProducao ? { erro: "Erro interno no servidor" } : { erro: "Erro interno no servidor", detalhes: mensagemDe(err) });
    });

    return app;
}
