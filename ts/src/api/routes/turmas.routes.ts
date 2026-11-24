import { Router, type Request, type Response } from "express";
import {
    TurmaRepository,
    type AtualizarTurmaInput,
    type CriarTurmaInput,
} from "../../db/repositories/turma.repository.ts";
import {
    lerBooleanoOpcional,
    lerCorpo,
    lerHorarioOpcional,
    lerId,
    lerInteiroObrigatorio,
    lerInteiroOpcional,
    lerSemestre,
    lerSemestreOpcionalQuery,
    lerTextoObrigatorio,
    lerTextoOpcionalCorpo,
    lerVinculosDocentesOpcional,
} from "../../entrada.ts";
import { ErroNaoEncontrado, ErroRequisicao } from "../../erros.ts";

export type RepoTurmasRota = Pick<TurmaRepository, "listarPorSemestre" | "listarTodas" | "buscarPorId">
    & Partial<Pick<TurmaRepository, "criar" | "atualizar" | "deletar">>;

export function criarTurmasRouter(repo: RepoTurmasRota = new TurmaRepository()): Router {
    const padrao = repo instanceof TurmaRepository ? repo : new TurmaRepository();
    const router = Router();

    router.get("/", async (req: Request, res: Response) => {
        const semestre = lerSemestreOpcionalQuery(req.query.semestre);
        const requerIc = lerBooleanoOpcional(req.query.requer_ic, "requer_ic");

        let turmas = semestre ? await repo.listarPorSemestre(semestre) : await repo.listarTodas();
        if (requerIc !== undefined) turmas = turmas.filter((t) => t.requerAlocacaoIc === requerIc);
        res.json(turmas);
    });

    router.get("/:id", async (req: Request, res: Response) => {
        const id = lerId(req.params.id, "id");
        const turma = await repo.buscarPorId(id);
        if (!turma) throw new ErroNaoEncontrado(`Turma de id ${id} não encontrada`);
        res.json(turma);
    });

    router.post("/", async (req: Request, res: Response) => {
        const body = lerCorpo(req.body);
        const disciplinaCodigo = lerTextoObrigatorio(
            body.disciplinaCodigo ?? body.idDisciplina,
            "disciplinaCodigo",
            20,
        ).toUpperCase();
        const horarioSigaa = lerHorarioOpcional(body.horarioSigaa) ?? "";
        const aulasSemanais = body.aulasSemanais === null
            ? null
            : lerInteiroOpcional(body.aulasSemanais, "aulasSemanais", 1, 30);

        const dados: CriarTurmaInput = {
            disciplinaCodigo,
            codigoTurma: lerTextoObrigatorio(body.codigoTurma, "codigoTurma", 10),
            semestre: lerSemestre(body.semestre),
            cursosOfertados: lerTextoObrigatorio(body.cursosOfertados, "cursosOfertados", 100),
            vagas: lerInteiroObrigatorio(body.vagas, "vagas", 0, 2000),
            matriculados: lerInteiroOpcional(body.matriculados, "matriculados", 0, 2000) ?? 0,
            requerAlocacaoIc: lerBooleanoOpcional(body.requerAlocacaoIc, "requerAlocacaoIc") ?? true,
            horarioSigaa,
            aulasSemanais,
            permitirMudarFormato: lerBooleanoOpcional(body.permitirMudarFormato, "permitirMudarFormato") ?? false,
            professores: lerVinculosDocentesOpcional(body.professores, "professores"),
        };

        const criada = await (repo.criar ? repo.criar(dados) : padrao.criar(dados));
        res.status(201).json(criada);
    });

    router.put("/:id", async (req: Request, res: Response) => {
        const id = lerId(req.params.id, "id");
        const body = lerCorpo(req.body);
        const dados: AtualizarTurmaInput = {};

        const codigoTurma = lerTextoOpcionalCorpo(body.codigoTurma, "codigoTurma", 10);
        if (codigoTurma !== undefined) dados.codigoTurma = codigoTurma;
        if (body.semestre !== undefined) dados.semestre = lerSemestre(body.semestre);
        const cursosOfertados = lerTextoOpcionalCorpo(body.cursosOfertados, "cursosOfertados", 100);
        if (cursosOfertados !== undefined) dados.cursosOfertados = cursosOfertados;
        const vagas = lerInteiroOpcional(body.vagas, "vagas", 0, 2000);
        if (vagas !== undefined) dados.vagas = vagas;
        const matriculados = lerInteiroOpcional(body.matriculados, "matriculados", 0, 2000);
        if (matriculados !== undefined) dados.matriculados = matriculados;
        const requerAlocacaoIc = lerBooleanoOpcional(body.requerAlocacaoIc, "requerAlocacaoIc");
        if (requerAlocacaoIc !== undefined) dados.requerAlocacaoIc = requerAlocacaoIc;

        if (body.horarioSigaa !== undefined) {
            dados.horarioSigaa = body.horarioSigaa === "" ? "" : (lerHorarioOpcional(body.horarioSigaa) ?? "");
        }
        if (body.aulasSemanais !== undefined) {
            dados.aulasSemanais = body.aulasSemanais === null
                ? null
                : lerInteiroOpcional(body.aulasSemanais, "aulasSemanais", 1, 30);
        }
        const permitirMudarFormato = lerBooleanoOpcional(body.permitirMudarFormato, "permitirMudarFormato");
        if (permitirMudarFormato !== undefined) dados.permitirMudarFormato = permitirMudarFormato;
        const professores = lerVinculosDocentesOpcional(body.professores, "professores");
        if (professores !== undefined) dados.professores = professores;

        if (Object.keys(dados).length === 0) {
            throw new ErroRequisicao("Informe ao menos um campo para atualizar a turma");
        }

        const atualizada = await (repo.atualizar ? repo.atualizar(id, dados) : padrao.atualizar(id, dados));
        if (!atualizada) throw new ErroNaoEncontrado(`Turma de id ${id} não encontrada`);
        res.json(atualizada);
    });

    router.patch("/:id/motor", async (req: Request, res: Response) => {
        const id = lerId(req.params.id, "id");
        const body = lerCorpo(req.body);
        const permitirMudarFormato = lerBooleanoOpcional(body.permitirMudarFormato, "permitirMudarFormato");
        if (permitirMudarFormato === undefined) {
            throw new ErroRequisicao("permitirMudarFormato é obrigatório e deve ser booleano");
        }
        const atualizada = await (repo.atualizar
            ? repo.atualizar(id, { permitirMudarFormato })
            : padrao.atualizar(id, { permitirMudarFormato }));
        if (!atualizada) throw new ErroNaoEncontrado(`Turma de id ${id} não encontrada`);
        res.json(atualizada);
    });

    router.delete("/:id", async (req: Request, res: Response) => {
        const id = lerId(req.params.id, "id");
        const removida = await (repo.deletar ? repo.deletar(id) : padrao.deletar(id));
        if (!removida) throw new ErroNaoEncontrado(`Turma de id ${id} não encontrada`);
        res.status(204).end();
    });

    return router;
}

export const turmasRouter = criarTurmasRouter();
