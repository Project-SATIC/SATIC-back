import { Router, type Request, type Response } from "express";
import { TurmaRepository } from "../../db/repositories/index.ts";

export const turmasRouter = Router();
const repo = new TurmaRepository();

turmasRouter.get("/", async (req: Request, res: Response) => {
    try {
        const { semestre, requer_ic } = req.query;

        let turmas = typeof semestre === "string" && semestre.trim() !== ""
            ? await repo.listarPorSemestre(semestre.trim())
            : await repo.listarTodas();

        if (requer_ic === "true" || requer_ic === "1") {
            turmas = turmas.filter((t) => t.requerAlocacaoIc);
        } else if (requer_ic === "false" || requer_ic === "0") {
            turmas = turmas.filter((t) => !t.requerAlocacaoIc);
        }

        res.json(turmas);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ erro: "Erro ao listar turmas", detalhes: msg });
    }
});

turmasRouter.get("/:id", async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            res.status(400).json({ erro: "ID inválido" });
            return;
        }

        const turma = await repo.buscarPorId(id);
        if (!turma) {
            res.status(404).json({ erro: `Turma de id ${id} não encontrada` });
            return;
        }
        res.json(turma);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ erro: "Erro ao buscar turma", detalhes: msg });
    }
});
