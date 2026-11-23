import { Router, type Request, type Response } from "express";
import { AlocacaoRepository } from "../../db/repositories/index.ts";
import { AlocadorService } from "../../motor/alocador.service.ts";
import { RemanejamentoService } from "../../motor/remanejamento.service.ts";
import { responderErroBanco } from "../pg-errors.ts";
import { parseBooleanoEstrito, parseIdParam } from "../validation.ts";

export const alocacoesRouter = Router();
const repo = new AlocacaoRepository();

alocacoesRouter.get("/", async (req: Request, res: Response) => {
    try {
        const { semestre } = req.query;
        if (semestre !== undefined && typeof semestre !== "string") {
            res.status(400).json({ erro: "Query 'semestre' deve ser uma string" });
            return;
        }

        const alocacoes = typeof semestre === "string" && semestre.trim() !== ""
            ? await repo.listarPorSemestre(semestre.trim())
            : await repo.listarTodas();

        res.json(alocacoes);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao listar alocações", "leitura");
    }
});

alocacoesRouter.get("/:id", async (req: Request, res: Response) => {
    try {
        const id = parseIdParam(req.params.id);
        if (id === null) {
            res.status(400).json({ erro: "ID inválido" });
            return;
        }

        const alocacao = await repo.buscarPorId(id);
        if (!alocacao) {
            res.status(404).json({ erro: `Alocação de id ${id} não encontrada` });
            return;
        }
        res.json(alocacao);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao buscar alocação", "leitura");
    }
});

alocacoesRouter.delete("/:id", async (req: Request, res: Response) => {
    try {
        const id = parseIdParam(req.params.id);
        if (id === null) {
            res.status(400).json({ erro: "ID inválido" });
            return;
        }

        const removida = await repo.deletarProtegido(id);
        if (!removida) {
            res.status(404).json({ erro: `Alocação de id ${id} não encontrada` });
            return;
        }
        res.status(204).end();
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao remover alocação", "remocao");
    }
});

alocacoesRouter.post("/gerar", async (req: Request, res: Response) => {
    try {
        const { semestre, persistir, limiteNos, semSalas } = req.body || {};

        let persistirBool = true;
        if (persistir !== undefined) {
            const parsed = parseBooleanoEstrito(persistir);
            if (parsed === null) {
                res.status(400).json({ erro: "Campo 'persistir' deve ser booleano" });
                return;
            }
            persistirBool = parsed;
        }

        const service = new AlocadorService();
        const resultado = await service.gerarAlocacao({
            semestre,
            persistir: persistirBool,
            limiteNos,
            semSalas,
        });
        res.json(resultado);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Falha na geração de alocações", "escrita");
    }
});

alocacoesRouter.post("/validar", async (req: Request, res: Response) => {
    try {
        const service = new RemanejamentoService();
        const resultado = await service.validar(req.body || {});
        res.json(resultado);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao validar alocação", "leitura");
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
        responderErroBanco(res, err, "Erro ao confirmar alocação", "escrita");
    }
});


