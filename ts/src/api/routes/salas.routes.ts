import { Router, type Request, type Response } from "express";
import { SalaRepository } from "../../db/repositories/index.ts";

export const salasRouter = Router();
const repo = new SalaRepository();

salasRouter.get("/", async (req: Request, res: Response) => {
    try {
        const { alocavel_ic, bloco } = req.query;

        let salas = await repo.listarTodas();

        if (alocavel_ic === "true" || alocavel_ic === "1") {
            salas = salas.filter((s) => s.alocavelIc);
        } else if (alocavel_ic === "false" || alocavel_ic === "0") {
            salas = salas.filter((s) => !s.alocavelIc);
        }

        if (typeof bloco === "string" && bloco.trim() !== "") {
            salas = salas.filter((s) => s.bloco.toLowerCase() === bloco.trim().toLowerCase());
        }

        res.json(salas);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ erro: "Erro ao listar salas", detalhes: msg });
    }
});

salasRouter.get("/:id", async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            res.status(400).json({ erro: "ID inválido" });
            return;
        }

        const sala = await repo.buscarPorId(id);
        if (!sala) {
            res.status(404).json({ erro: `Sala de id ${id} não encontrada` });
            return;
        }
        res.json(sala);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ erro: "Erro ao buscar sala", detalhes: msg });
    }
});
