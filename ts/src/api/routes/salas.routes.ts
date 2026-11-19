import { Router, type Request, type Response } from "express";
import { SalaRepository } from "../../db/repositories/index.ts";
import { lerBooleanoOpcional, lerId, lerTextoOpcionalQuery } from "../../entrada.ts";
import { ErroNaoEncontrado } from "../../erros.ts";

export type RepoSalasRota = Pick<SalaRepository, "listarTodas" | "buscarPorId">;

export function criarSalasRouter(repo: RepoSalasRota = new SalaRepository()): Router {
    const router = Router();

    router.get("/", async (req: Request, res: Response) => {
        const alocavelIc = lerBooleanoOpcional(req.query.alocavel_ic, "alocavel_ic");
        const bloco = (lerTextoOpcionalQuery(req.query.bloco, "bloco") ?? "").toLowerCase();

        let salas = await repo.listarTodas();
        if (alocavelIc !== undefined) salas = salas.filter((s) => s.alocavelIc === alocavelIc);
        if (bloco !== "") salas = salas.filter((s) => s.bloco.toLowerCase() === bloco);
        res.json(salas);
    });

    router.get("/:id", async (req: Request, res: Response) => {
        const id = lerId(req.params.id, "id");
        const sala = await repo.buscarPorId(id);
        if (!sala) throw new ErroNaoEncontrado(`Sala de id ${id} não encontrada`);
        res.json(sala);
    });

    return router;
}

export const salasRouter = criarSalasRouter();

// -------------------------------------------------------------------------------------------------
// Rotas reservadas (ainda não implementadas). Hoje o front faz isso só na sessão do navegador.
//
// POST   /api/salas          cadastro de espaço (nome, capacidade, tipo, bloco, alocavelIc, pcs, equipamentos)
// PUT    /api/salas/:id      edição do espaço
// PATCH  /api/salas/:id/status   { status: "Disponível" | "Manutenção" }
//   Espaço em manutenção sai do pool do motor e do validador. Exige coluna `status` na tabela sala
//   (e talvez `pcs`, `equipamentos`, `pavimento`, `observacao`, que o front já mostra).
// -------------------------------------------------------------------------------------------------
