import { Router, type Request, type Response } from "express";
import { AlocacaoRepository } from "../../db/repositories/index.ts";
import { AlocadorService } from "../../motor/alocador.service.ts";
import { RemanejamentoService } from "../../motor/remanejamento.service.ts";

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

alocacoesRouter.post("/validar", async (req: Request, res: Response) => {
    try {
        const service = new RemanejamentoService();
        const resultado = await service.validar(req.body || {});
        res.json(resultado);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes("não encontrada") ? 404 : 400;
        res.status(status).json({ erro: "Erro ao validar alocação", detalhes: msg });
    }
});

alocacoesRouter.post("/confirmar", async (req: Request, res: Response) => {
    try {
        const service = new RemanejamentoService();
        const resultado = await service.confirmar(req.body || {});
        if (!resultado.sucesso) {
            res.status(409).json(resultado);
            return;
        }
        res.json(resultado);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes("não encontrada") ? 404 : 400;
        res.status(status).json({ erro: "Erro ao confirmar alocação", detalhes: msg });
    }
});


