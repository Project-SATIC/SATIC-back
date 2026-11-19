import { Router, type Request, type Response } from "express";
import { ProfessorRepository } from "../../db/repositories/index.ts";
import { ErroNaoEncontrado } from "../../erros.ts";

export type RepoProfessoresRota = Pick<ProfessorRepository, "listarTodos" | "buscarPorSiape">;

export function criarProfessoresRouter(repo: RepoProfessoresRota = new ProfessorRepository()): Router {
    const router = Router();

    router.get("/", async (_req: Request, res: Response) => {
        res.json(await repo.listarTodos());
    });

    router.get("/:siape", async (req: Request, res: Response) => {
        const siape = String(req.params.siape).trim();
        const professor = await repo.buscarPorSiape(siape);
        if (!professor) throw new ErroNaoEncontrado(`Professor com SIAPE '${siape}' não encontrado`);
        res.json(professor);
    });

    return router;
}

export const professoresRouter = criarProfessoresRouter();

// -------------------------------------------------------------------------------------------------
// Rotas reservadas (ainda não implementadas). Hoje o front faz isso só na sessão do navegador.
//
// PUT /api/professores/:siape/disponibilidade
//   Grade de disponibilidade por aula: "indisponivel" (já existe no banco como restricoes_horario,
//   usada pela RN-02) e "preferencial" (ainda não existe; seria uma preferência para o motor,
//   não uma regra). Exige guardar as preferências no banco.
// POST/PUT /api/professores          cadastro e edição de docentes (regime, carga máxima)
// -------------------------------------------------------------------------------------------------
