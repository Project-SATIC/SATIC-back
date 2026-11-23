import { Router, type Request, type Response } from "express";
import { comTransacao } from "../../db/connection.ts";
import {
    canonicalizarHorarioIndisponivel,
    formatarHorarioIndisponivel,
    parseHorarioIndisponivel,
    ProfessorRepository,
} from "../../db/repositories/index.ts";
import { ErroNaoEncontrado } from "../../shared/erros.ts";
import type { IndisponibilidadeDocente } from "../../shared/tipos.ts";
import { responderErroBanco } from "../pg-errors.ts";
import { extrairParamString } from "../validation.ts";

export const professoresRouter = Router();
const repo = new ProfessorRepository();

function normalizarRestricao(
    siape: string,
    item: unknown
): { codigo: string; ind: IndisponibilidadeDocente } | null {
    let bruto: string | null = null;

    if (typeof item === "string" && item.trim() !== "") {
        bruto = item.trim();
    } else if (item && typeof item === "object") {
        const obj = item as Partial<IndisponibilidadeDocente> & { horarioIndisponivel?: unknown };
        if (typeof obj.horarioIndisponivel === "string" && obj.horarioIndisponivel.trim() !== "") {
            bruto = obj.horarioIndisponivel.trim();
        } else if (
            typeof obj.diaSemana === "string" &&
            typeof obj.turno === "string" &&
            typeof obj.indiceHorario === "string"
        ) {
            bruto = formatarHorarioIndisponivel({
                professorMatricula: siape,
                diaSemana: obj.diaSemana.trim(),
                turno: obj.turno.trim(),
                indiceHorario: obj.indiceHorario.trim(),
            });
        }
    }

    if (!bruto) return null;
    const codigo = canonicalizarHorarioIndisponivel(bruto);
    if (!codigo) return null;

    return { codigo, ind: parseHorarioIndisponivel(siape, codigo) };
}

function normalizarListaRestricoes(
    siape: string,
    lista: unknown
): { codigos: string[]; indisponibilidades: IndisponibilidadeDocente[] } | null {
    if (!Array.isArray(lista)) return null;
    const vistos = new Set<string>();
    const codigos: string[] = [];
    const indisponibilidades: IndisponibilidadeDocente[] = [];

    for (const item of lista) {
        const norm = normalizarRestricao(siape, item);
        if (!norm) return null;
        if (vistos.has(norm.codigo)) continue;
        vistos.add(norm.codigo);
        codigos.push(norm.codigo);
        indisponibilidades.push(norm.ind);
    }
    return { codigos, indisponibilidades };
}

professoresRouter.get("/", async (_req: Request, res: Response) => {
    try {
        const professores = await repo.listarTodos();
        res.json(professores);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao listar professores", "leitura");
    }
});

professoresRouter.get("/:siape", async (req: Request, res: Response) => {
    try {
        const siape = extrairParamString(req.params.siape).trim();
        const professor = await repo.buscarPorSiape(siape);
        if (!professor) {
            res.status(404).json({ erro: `Professor com SIAPE '${siape}' não encontrado` });
            return;
        }
        res.json(professor);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao buscar professor", "leitura");
    }
});

professoresRouter.post("/", async (req: Request, res: Response) => {
    try {
        const { matriculaSiape, nome, indisponibilidades } = req.body || {};

        if (typeof matriculaSiape !== "string" || matriculaSiape.trim() === "") {
            res.status(400).json({ erro: "Campo 'matriculaSiape' é obrigatório" });
            return;
        }
        if (typeof nome !== "string" || nome.trim() === "") {
            res.status(400).json({ erro: "Campo 'nome' é obrigatório" });
            return;
        }

        const siape = matriculaSiape.trim();
        let listaIndisps: IndisponibilidadeDocente[] = [];
        if (indisponibilidades !== undefined) {
            const parsed = normalizarListaRestricoes(siape, indisponibilidades);
            if (!parsed) {
                res.status(400).json({ erro: "Campo 'indisponibilidades' inválido" });
                return;
            }
            listaIndisps = parsed.indisponibilidades;
        }

        const criado = await repo.criar({
            matriculaSiape: siape,
            nome: nome.trim(),
            indisponibilidades: listaIndisps,
        });
        res.status(201).json(criado);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao criar professor", "escrita");
    }
});

professoresRouter.put("/:siape", async (req: Request, res: Response) => {
    try {
        const siape = extrairParamString(req.params.siape).trim();
        const { nome, indisponibilidades } = req.body || {};
        const dados: { nome?: string; indisponibilidades?: IndisponibilidadeDocente[] } = {};

        if (nome !== undefined) {
            if (typeof nome !== "string" || nome.trim() === "") {
                res.status(400).json({ erro: "Campo 'nome' não pode ser vazio" });
                return;
            }
            dados.nome = nome.trim();
        }
        if (indisponibilidades !== undefined) {
            const parsed = normalizarListaRestricoes(siape, indisponibilidades);
            if (!parsed) {
                res.status(400).json({ erro: "Campo 'indisponibilidades' inválido" });
                return;
            }
            dados.indisponibilidades = parsed.indisponibilidades;
        }

        const atualizado = await repo.atualizar(siape, dados);
        if (!atualizado) {
            res.status(404).json({ erro: `Professor com SIAPE '${siape}' não encontrado` });
            return;
        }
        res.json(atualizado);
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao atualizar professor", "escrita");
    }
});

professoresRouter.delete("/:siape", async (req: Request, res: Response) => {
    try {
        const siape = extrairParamString(req.params.siape).trim();
        const removido = await repo.deletar(siape);
        if (!removido) {
            res.status(404).json({ erro: `Professor com SIAPE '${siape}' não encontrado` });
            return;
        }
        res.status(204).end();
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao remover professor", "remocao");
    }
});

professoresRouter.post("/:siape/restricoes", async (req: Request, res: Response) => {
    try {
        const siape = extrairParamString(req.params.siape).trim();
        const norm = normalizarRestricao(siape, req.body);
        if (!norm) {
            res.status(400).json({
                erro: "Informe 'horarioIndisponivel' válido (ex: 'SEX-T-56' ou '6T56') ou { diaSemana, turno, indiceHorario }",
            });
            return;
        }

        const restricoes = await comTransacao(async (client) => {
            const professor = await repo.buscarPorSiape(siape, client);
            if (!professor) {
                throw new ErroNaoEncontrado(`Professor com SIAPE '${siape}' não encontrado`);
            }
            await repo.adicionarRestricao(siape, norm.codigo, client);
            return repo.listarRestricoesPorProfessor(siape, client);
        });

        res.status(201).json({ matriculaSiape: siape, indisponibilidades: restricoes });
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao adicionar restrição de horário", "escrita");
    }
});

professoresRouter.put("/:siape/restricoes", async (req: Request, res: Response) => {
    try {
        const siape = extrairParamString(req.params.siape).trim();
        const { indisponibilidades } = req.body || {};
        const parsed = normalizarListaRestricoes(siape, indisponibilidades);
        if (!parsed) {
            res.status(400).json({ erro: "Campo 'indisponibilidades' inválido" });
            return;
        }

        const atualizadas = await comTransacao(async (client) => {
            const professor = await repo.buscarPorSiape(siape, client);
            if (!professor) {
                throw new ErroNaoEncontrado(`Professor com SIAPE '${siape}' não encontrado`);
            }
            return repo.substituirRestricoes(siape, parsed.codigos, client);
        });

        res.json({ matriculaSiape: siape, indisponibilidades: atualizadas });
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao substituir restrições de horário", "escrita");
    }
});

professoresRouter.delete("/:siape/restricoes/:horario", async (req: Request, res: Response) => {
    try {
        const siape = extrairParamString(req.params.siape).trim();
        const horarioBruto = extrairParamString(req.params.horario).trim();
        const removida = await repo.removerRestricao(siape, horarioBruto);
        if (!removida) {
            res.status(404).json({
                erro: `Restrição '${horarioBruto}' não encontrada para o professor '${siape}'`,
            });
            return;
        }
        res.status(204).end();
    } catch (err: unknown) {
        responderErroBanco(res, err, "Erro ao remover restrição de horário", "remocao");
    }
});
