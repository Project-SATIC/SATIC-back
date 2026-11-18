import { Router, type Request, type Response } from "express";
import { AlocacaoRepository } from "../../db/repositories/index.ts";
import { AlocadorService } from "../../motor/alocador.service.ts";

export const alocacoesRouter = Router();
const repo = new AlocacaoRepository();

alocacoesRouter.get("/", async (req: Request, res: Response) => {
    try {
        const { semestre } = req.query;

        const alocacoes = typeof semestre === "string" && semestre.trim() !== ""
            ? await repo.listarPorSemestre(semestre.trim())
            : await repo.listarTodas();

        res.json(alocacoes);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ erro: "Erro ao listar alocações", detalhes: msg });
    }
});

alocacoesRouter.post("/gerar", async (req: Request, res: Response) => {
    try {
        const { semestre, persistir, limiteNos, semSalas } = req.body || {};
        const service = new AlocadorService();
        const resultado = await service.gerarAlocacao({
            semestre,
            persistir: persistir !== false,
            limiteNos: typeof limiteNos === "number" ? limiteNos : undefined,
            semSalas: Array.isArray(semSalas) ? semSalas : undefined,
        });
        res.json(resultado);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes("Nenhuma turma encontrada") ? 400 : 500;
        res.status(status).json({ erro: "Falha na geração de alocações", detalhes: msg });
    }
});

