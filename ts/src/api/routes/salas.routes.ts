import { Router, type Request, type Response } from "express";
import { SalaRepository, type AtualizarSalaInput, type CriarSalaInput } from "../../db/repositories/sala.repository.ts";
import {
    lerBooleanoOpcional,
    lerCorpo,
    lerId,
    lerInteiroObrigatorio,
    lerInteiroOpcional,
    lerListaDeTextosOpcional,
    lerStatusSalaOpcional,
    lerTextoObrigatorio,
    lerTextoOpcionalCorpo,
    lerTextoOpcionalQuery,
} from "../../entrada.ts";
import { ErroNaoEncontrado, ErroRequisicao } from "../../erros.ts";

export type RepoSalasRota = Pick<SalaRepository, "listarTodas" | "buscarPorId">
    & Partial<Pick<SalaRepository, "criar" | "atualizar" | "deletar">>;

export function criarSalasRouter(repo: RepoSalasRota = new SalaRepository()): Router {
    const padrao = repo instanceof SalaRepository ? repo : new SalaRepository();
    const router = Router();

    router.get("/", async (req: Request, res: Response) => {
        const alocavelIc = lerBooleanoOpcional(req.query.alocavel_ic, "alocavel_ic");
        const bloco = (lerTextoOpcionalQuery(req.query.bloco, "bloco") ?? "").toLowerCase();
        const statusFiltro = lerStatusSalaOpcional(lerTextoOpcionalQuery(req.query.status, "status"));

        let salas = await repo.listarTodas();
        if (alocavelIc !== undefined) salas = salas.filter((s) => s.alocavelIc === alocavelIc);
        if (bloco !== "") salas = salas.filter((s) => s.bloco.toLowerCase() === bloco);
        if (statusFiltro !== undefined) salas = salas.filter((s) => (s.status ?? "Disponível") === statusFiltro);
        res.json(salas);
    });

    router.get("/:id", async (req: Request, res: Response) => {
        const id = lerId(req.params.id, "id");
        const sala = await repo.buscarPorId(id);
        if (!sala) throw new ErroNaoEncontrado(`Sala de id ${id} não encontrada`);
        res.json(sala);
    });

    router.post("/", async (req: Request, res: Response) => {
        const body = lerCorpo(req.body);
        const dados: CriarSalaInput = {
            nome: lerTextoObrigatorio(body.nome, "nome", 100),
            capacidade: lerInteiroObrigatorio(body.capacidade, "capacidade", 1, 10_000),
            tipoEspaco: lerTextoObrigatorio(body.tipoEspaco, "tipoEspaco", 50),
            bloco: lerTextoObrigatorio(body.bloco, "bloco", 50),
            alocavelIc: lerBooleanoOpcional(body.alocavelIc, "alocavelIc") ?? true,
            status: lerStatusSalaOpcional(body.status) ?? "Disponível",
            pcs: lerInteiroOpcional(body.pcs, "pcs", 0, 10_000),
            equipamentos: lerListaDeTextosOpcional(body.equipamentos, "equipamentos"),
            observacao: body.observacao === null
                ? null
                : lerTextoOpcionalCorpo(body.observacao, "observacao", 1000),
        };
        const criada = await (repo.criar ? repo.criar(dados) : padrao.criar(dados));
        res.status(201).json(criada);
    });

    router.put("/:id", async (req: Request, res: Response) => {
        const id = lerId(req.params.id, "id");
        const body = lerCorpo(req.body);
        const dados: AtualizarSalaInput = {};

        const nome = lerTextoOpcionalCorpo(body.nome, "nome", 100);
        if (nome !== undefined) dados.nome = nome;
        const capacidade = lerInteiroOpcional(body.capacidade, "capacidade", 1, 10_000);
        if (capacidade !== undefined) dados.capacidade = capacidade;
        const tipoEspaco = lerTextoOpcionalCorpo(body.tipoEspaco, "tipoEspaco", 50);
        if (tipoEspaco !== undefined) dados.tipoEspaco = tipoEspaco;
        const bloco = lerTextoOpcionalCorpo(body.bloco, "bloco", 50);
        if (bloco !== undefined) dados.bloco = bloco;
        const alocavelIc = lerBooleanoOpcional(body.alocavelIc, "alocavelIc");
        if (alocavelIc !== undefined) dados.alocavelIc = alocavelIc;
        const status = lerStatusSalaOpcional(body.status);
        if (status !== undefined) dados.status = status;
        const pcs = lerInteiroOpcional(body.pcs, "pcs", 0, 10_000);
        if (pcs !== undefined) dados.pcs = pcs;
        if (body.equipamentos !== undefined) {
            dados.equipamentos = lerListaDeTextosOpcional(body.equipamentos, "equipamentos") ?? [];
        }
        if (body.observacao !== undefined) {
            dados.observacao = body.observacao === null || body.observacao === ""
                ? null
                : lerTextoObrigatorio(body.observacao, "observacao", 1000);
        }

        if (Object.keys(dados).length === 0) {
            throw new ErroRequisicao("Informe ao menos um campo para atualizar a sala");
        }

        const atualizada = await (repo.atualizar ? repo.atualizar(id, dados) : padrao.atualizar(id, dados));
        if (!atualizada) throw new ErroNaoEncontrado(`Sala de id ${id} não encontrada`);
        res.json(atualizada);
    });

    router.patch("/:id/status", async (req: Request, res: Response) => {
        const id = lerId(req.params.id, "id");
        const body = lerCorpo(req.body);
        const status = lerStatusSalaOpcional(body.status);
        if (!status) {
            throw new ErroRequisicao("status é obrigatório ('Disponível' ou 'Manutenção')");
        }
        const atualizada = await (repo.atualizar ? repo.atualizar(id, { status }) : padrao.atualizar(id, { status }));
        if (!atualizada) throw new ErroNaoEncontrado(`Sala de id ${id} não encontrada`);
        res.json(atualizada);
    });

    router.delete("/:id", async (req: Request, res: Response) => {
        const id = lerId(req.params.id, "id");
        const removida = await (repo.deletar ? repo.deletar(id) : padrao.deletar(id));
        if (!removida) throw new ErroNaoEncontrado(`Sala de id ${id} não encontrada`);
        res.status(204).end();
    });

    return router;
}

export const salasRouter = criarSalasRouter();
