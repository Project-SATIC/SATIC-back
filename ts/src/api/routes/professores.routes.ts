import { Router, type Request, type Response } from "express";
import {
    ProfessorRepository,
    canonicalizarHorarioIndisponivel,
    type AtualizarProfessorInput,
} from "../../db/repositories/professor.repository.ts";
import {
    lerCorpo,
    lerListaDeTextosOpcional,
    lerTextoObrigatorio,
    lerTextoOpcionalCorpo,
} from "../../entrada.ts";
import { ErroNaoEncontrado, ErroRequisicao } from "../../erros.ts";

export type RepoProfessoresRota = Pick<ProfessorRepository, "listarTodos" | "buscarPorSiape">
    & Partial<Pick<ProfessorRepository, "criar" | "atualizar" | "deletar" | "adicionarRestricao" | "removerRestricao" | "listarRestricoesPorProfessor">>;

export function criarProfessoresRouter(repo: RepoProfessoresRota = new ProfessorRepository()): Router {
    const padrao = repo instanceof ProfessorRepository ? repo : new ProfessorRepository();
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

    router.post("/", async (req: Request, res: Response) => {
        const body = lerCorpo(req.body);
        const matriculaSiape = lerTextoObrigatorio(body.matriculaSiape, "matriculaSiape", 50);
        const nome = lerTextoObrigatorio(body.nome, "nome", 255);
        const indisponibilidades = lerListaDeTextosOpcional(body.indisponibilidades, "indisponibilidades");

        const criado = await (repo.criar
            ? repo.criar({ matriculaSiape, nome, indisponibilidades })
            : padrao.criar({ matriculaSiape, nome, indisponibilidades }));
        res.status(201).json(criado);
    });

    router.put("/:siape", async (req: Request, res: Response) => {
        const siape = lerTextoObrigatorio(req.params.siape, "siape", 50);
        const body = lerCorpo(req.body);
        const dados: AtualizarProfessorInput = {};

        const nome = lerTextoOpcionalCorpo(body.nome, "nome", 255);
        if (nome !== undefined) dados.nome = nome;
        if (body.indisponibilidades !== undefined) {
            dados.indisponibilidades = lerListaDeTextosOpcional(body.indisponibilidades, "indisponibilidades") ?? [];
        }

        if (Object.keys(dados).length === 0) {
            throw new ErroRequisicao("Informe ao menos um campo para atualizar o professor");
        }

        const atualizado = await (repo.atualizar ? repo.atualizar(siape, dados) : padrao.atualizar(siape, dados));
        if (!atualizado) throw new ErroNaoEncontrado(`Professor com SIAPE '${siape}' não encontrado`);
        res.json(atualizado);
    });

    router.delete("/:siape", async (req: Request, res: Response) => {
        const siape = lerTextoObrigatorio(req.params.siape, "siape", 50);
        const removido = await (repo.deletar ? repo.deletar(siape) : padrao.deletar(siape));
        if (!removido) throw new ErroNaoEncontrado(`Professor com SIAPE '${siape}' não encontrado`);
        res.status(204).end();
    });

    router.post("/:siape/restricoes", async (req: Request, res: Response) => {
        const siape = lerTextoObrigatorio(req.params.siape, "siape", 50);
        const body = lerCorpo(req.body);
        const horarioBruto = body.horarioIndisponivel ?? body.horario;
        const canonico = canonicalizarHorarioIndisponivel(lerTextoObrigatorio(horarioBruto, "horarioIndisponivel", 50));

        const professor = await repo.buscarPorSiape(siape);
        if (!professor) throw new ErroNaoEncontrado(`Professor com SIAPE '${siape}' não encontrado`);

        await (repo.adicionarRestricao
            ? repo.adicionarRestricao(siape, canonico)
            : padrao.adicionarRestricao(siape, canonico));

        const indisponibilidades = await (repo.listarRestricoesPorProfessor
            ? repo.listarRestricoesPorProfessor(siape)
            : padrao.listarRestricoesPorProfessor(siape));

        res.status(201).json({
            matriculaSiape: siape,
            horarioIndisponivel: canonico,
            indisponibilidades,
        });
    });

    router.delete("/:siape/restricoes/:horario", async (req: Request, res: Response) => {
        const siape = lerTextoObrigatorio(req.params.siape, "siape", 50);
        const horario = lerTextoObrigatorio(req.params.horario, "horario", 50);

        const professor = await repo.buscarPorSiape(siape);
        if (!professor) throw new ErroNaoEncontrado(`Professor com SIAPE '${siape}' não encontrado`);

        const removida = await (repo.removerRestricao
            ? repo.removerRestricao(siape, horario)
            : padrao.removerRestricao(siape, horario));
        if (!removida) throw new ErroNaoEncontrado(`Restrição '${horario}' não encontrada para o professor '${siape}'`);
        res.status(204).end();
    });

    return router;
}

export const professoresRouter = criarProfessoresRouter();
