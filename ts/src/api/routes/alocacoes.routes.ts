import { Router, type Request, type Response } from "express";
import { AlocacaoRepository } from "../../db/repositories/index.ts";
import { AlocadorService, SEMESTRE_PADRAO } from "../../motor/alocador.service.ts";
import { RemanejamentoService } from "../../motor/remanejamento.service.ts";
import { MAX_NOS_BUSCA } from "../../motor/state-space-search.ts";
import { SugestoesService, lerMovimentosRascunho } from "../../motor/sugestoes.service.ts";
import { LIMITE_NOS_SUGESTOES } from "../../motor/sugestoes.ts";
import {
    lerBooleanoOpcional,
    lerCorpo,
    lerId,
    lerInteiroOpcional,
    lerListaDeIdsOpcional,
    lerListaDeTextosOpcional,
    lerSemestre,
    lerSemestreOpcionalQuery,
} from "../../entrada.ts";
import { ErroConflito, ErroNaoEncontrado } from "../../erros.ts";

/** Teto do limite de nós aceito pela API (2x o padrão do motor) para uma requisição não travar o servidor. */
export const LIMITE_NOS_MAXIMO_API = MAX_NOS_BUSCA * 2;

export interface ServicosAlocacao {
    alocacaoRepo: Pick<AlocacaoRepository, "listarPorSemestre" | "listarTodas">
        & Partial<Pick<
            AlocacaoRepository,
            "buscarPorId" | "deletarProtegido" | "obterPublicacaoSemestre" | "definirPublicacaoSemestre" | "publicarSemestre"
        >>;
    alocador: Pick<AlocadorService, "gerarAlocacao">;
    remanejamento: Pick<RemanejamentoService, "validar" | "confirmar" | "confirmarLote">;
    sugestoes: Pick<SugestoesService, "sugerir" | "conflitos">;
}

/** Erros lançados nos handlers (ErroHttp, JSON inválido etc.) seguem para o handler global em app.ts. */
export function criarAlocacoesRouter(servicos: Partial<ServicosAlocacao> = {}): Router {
    const alocacaoRepo = servicos.alocacaoRepo ?? new AlocacaoRepository();
    const repoPadrao = alocacaoRepo instanceof AlocacaoRepository ? alocacaoRepo : new AlocacaoRepository();
    const alocador = servicos.alocador ?? new AlocadorService();
    const remanejamento = servicos.remanejamento ?? new RemanejamentoService();
    const sugestoes = servicos.sugestoes ?? new SugestoesService();
    const router = Router();

    const despublicarSeReal = async (semestre: string) => {
        if (alocacaoRepo instanceof AlocacaoRepository || alocacaoRepo.definirPublicacaoSemestre) {
            const fn = alocacaoRepo.definirPublicacaoSemestre?.bind(alocacaoRepo) ?? repoPadrao.definirPublicacaoSemestre.bind(repoPadrao);
            await fn(semestre, false).catch(() => undefined);
        }
    };

    /** Conflitos e pendências do semestre, como o servidor enxerga (Central de Conflitos). */
    router.get("/conflitos", async (req: Request, res: Response) => {
        res.json(await sugestoes.conflitos(lerSemestre(req.query.semestre, SEMESTRE_PADRAO)));
    });

    /**
     * Estado de publicação oficial da grade do semestre.
     * Se constava como publicada mas surgiram conflitos ou pendências (ex.: sala entrou em manutenção),
     * desmarca automaticamente para nunca reportar como publicada uma grade inválida.
     */
    router.get("/publicacao", async (req: Request, res: Response) => {
        const semestre = lerSemestre(req.query.semestre, SEMESTRE_PADRAO);
        let pub = await (alocacaoRepo.obterPublicacaoSemestre
            ? alocacaoRepo.obterPublicacaoSemestre(semestre)
            : repoPadrao.obterPublicacaoSemestre(semestre));
        if (pub.publicada) {
            const diag = await sugestoes.conflitos(semestre).catch(() => null);
            if (diag && (diag.conflitos.length > 0 || diag.pendentes.length > 0)) {
                await despublicarSeReal(semestre);
                pub = { semestre, publicada: false, publicadoEm: pub.publicadoEm };
            }
        }
        res.json(pub);
    });

    /**
     * Publica oficialmente a grade do semestre: exige 0 conflitos e 0 pendências,
     * congela todas as alocações RASCUNHO como DEFINITIVA e grava `publicada = true`.
     */
    router.post("/publicar", async (req: Request, res: Response) => {
        const body = lerCorpo(req.body);
        const semestre = lerSemestre(body.semestre, SEMESTRE_PADRAO);
        const diag = await sugestoes.conflitos(semestre);
        if (diag.conflitos.length > 0 || diag.pendentes.length > 0) {
            throw new ErroConflito(
                "Não é possível publicar a grade enquanto houver conflitos ou turmas pendentes",
                { conflitos: diag.conflitos, pendentes: diag.pendentes },
            );
        }
        const resultado = await (alocacaoRepo.publicarSemestre
            ? alocacaoRepo.publicarSemestre(semestre)
            : repoPadrao.publicarSemestre(semestre));
        res.json(resultado);
    });

    /**
     * Motor de sugestões (horário + sala) para os conflitos e pendências. Não grava nada:
     * para aplicar, o front envia as mudanças escolhidas para /confirmar-lote.
     */
    router.post("/sugestoes", async (req: Request, res: Response) => {
        const body = lerCorpo(req.body);
        res.json(await sugestoes.sugerir(lerSemestre(body.semestre, SEMESTRE_PADRAO), {
            alvos: lerListaDeIdsOpcional(body.alvos, "alvos"),
            permitirMudarFormato: lerListaDeIdsOpcional(body.permitirMudarFormato, "permitirMudarFormato"),
            limiteNos: lerInteiroOpcional(body.limiteNos, "limiteNos", 1, LIMITE_NOS_SUGESTOES * 2),
            maxAlternativas: lerInteiroOpcional(body.maxAlternativas, "maxAlternativas", 0, 10),
        }, lerMovimentosRascunho(body.movimentos)));
    });

    router.get("/", async (req: Request, res: Response) => {
        const semestre = lerSemestreOpcionalQuery(req.query.semestre);
        res.json(semestre ? await alocacaoRepo.listarPorSemestre(semestre) : await alocacaoRepo.listarTodas());
    });

    router.get("/:id", async (req: Request, res: Response) => {
        const id = lerId(req.params.id, "id");
        const alocacao = await (alocacaoRepo.buscarPorId ? alocacaoRepo.buscarPorId(id) : repoPadrao.buscarPorId(id));
        if (!alocacao) throw new ErroNaoEncontrado(`Alocação de id ${id} não encontrada`);
        res.json(alocacao);
    });

    router.delete("/:id", async (req: Request, res: Response) => {
        const id = lerId(req.params.id, "id");
        const removida = await (alocacaoRepo.deletarProtegido
            ? alocacaoRepo.deletarProtegido(id)
            : repoPadrao.deletarProtegido(id));
        if (!removida) throw new ErroNaoEncontrado(`Alocação de id ${id} não encontrada`);
        res.status(204).end();
    });

    router.post("/gerar", async (req: Request, res: Response) => {
        const body = lerCorpo(req.body);
        const semestre = lerSemestre(body.semestre, SEMESTRE_PADRAO);
        const persistir = lerBooleanoOpcional(body.persistir, "persistir") ?? true;
        const resultado = await alocador.gerarAlocacao({
            semestre,
            persistir,
            limiteNos: lerInteiroOpcional(body.limiteNos, "limiteNos", 1, LIMITE_NOS_MAXIMO_API),
            semSalas: lerListaDeTextosOpcional(body.semSalas, "semSalas"),
            preservarDefinitivas: lerBooleanoOpcional(body.preservarDefinitivas, "preservarDefinitivas") ?? true,
        });
        if (persistir) await despublicarSeReal(semestre);
        res.json(resultado);
    });

    router.post("/validar", async (req: Request, res: Response) => {
        const body = lerCorpo(req.body);
        res.json(await remanejamento.validar({ turmaId: body.turmaId, salaId: body.salaId, horario: body.horario }));
    });

    router.post("/confirmar", async (req: Request, res: Response) => {
        const body = lerCorpo(req.body);
        const resultado = await remanejamento.confirmar({
            turmaId: body.turmaId,
            salaId: body.salaId,
            horario: body.horario,
            status: body.status,
        });
        if (resultado.sucesso && resultado.alocacao?.turma?.semestre) {
            await despublicarSeReal(resultado.alocacao.turma.semestre);
        }
        res.status(resultado.sucesso ? 200 : 409).json(resultado);
    });

    /**
     * "Confirmar tudo" do rascunho do front: { movimentos: [{ turmaId, salaId?, horario?, status?, acao? }] }.
     * 200 quando todos foram aceitos; 207 (Multi-Status) quando parte foi recusada; 409 quando nenhum foi.
     */
    router.post("/confirmar-lote", async (req: Request, res: Response) => {
        const body = lerCorpo(req.body);
        const resultado = await remanejamento.confirmarLote(body.movimentos);
        if (resultado.aceitos > 0) {
            const semestres = new Set<string>();
            for (const r of resultado.resultados) {
                if (r.sucesso && r.alocacao?.turma?.semestre) semestres.add(r.alocacao.turma.semestre);
            }
            if (semestres.size === 0) semestres.add(SEMESTRE_PADRAO);
            for (const s of semestres) await despublicarSeReal(s);
        }
        const status = resultado.recusados === 0 ? 200 : resultado.aceitos === 0 ? 409 : 207;
        res.status(status).json(resultado);
    });

    return router;
}
