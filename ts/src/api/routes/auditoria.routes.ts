import { Router, type Request, type Response } from "express";
import { AuditoriaRepository, type OperacaoAuditoria } from "../../db/repositories/index.ts";
import { lerId, lerTextoOpcionalQuery } from "../../entrada.ts";
import { ErroNaoEncontrado, ErroRequisicao } from "../../erros.ts";

export type RepoAuditoriaRota = Pick<AuditoriaRepository, "listar" | "buscarPorId">;

const OPERACOES_VALIDAS = new Set<OperacaoAuditoria>([
    "INSERT",
    "UPDATE",
    "DELETE",
    "PUBLICACAO",
    "DESPUBLICACAO",
    "GERACAO_MOTOR",
    "LOTE",
]);

function lerLimiteQuery(valor: unknown): number | undefined {
    if (valor === undefined || (typeof valor === "string" && valor.trim() === "")) return undefined;
    if (typeof valor !== "string") throw new ErroRequisicao("limite deve ser um inteiro entre 1 e 500");
    const n = Number(valor);
    if (!Number.isSafeInteger(n) || n < 1 || n > 500) {
        throw new ErroRequisicao("limite deve ser um inteiro entre 1 e 500");
    }
    return n;
}

export function criarAuditoriaRouter(repo: RepoAuditoriaRota = new AuditoriaRepository()): Router {
    const router = Router();

    router.get("/", async (req: Request, res: Response) => {
        const entidade = lerTextoOpcionalQuery(req.query.entidade, "entidade");
        const entidadeId = lerTextoOpcionalQuery(req.query.entidade_id ?? req.query.entidadeId, "entidade_id");
        const operacao = lerTextoOpcionalQuery(req.query.operacao, "operacao");
        if (operacao && !OPERACOES_VALIDAS.has(operacao as OperacaoAuditoria)) {
            throw new ErroRequisicao(
                `operacao inválida: use uma de ${[...OPERACOES_VALIDAS].join(", ")}`,
            );
        }
        const autor = lerTextoOpcionalQuery(req.query.autor, "autor");
        const requestId = lerTextoOpcionalQuery(req.query.request_id ?? req.query.requestId, "request_id");
        const limite = lerLimiteQuery(req.query.limite);

        const logs = await repo.listar({
            entidade,
            entidadeId,
            operacao,
            autor,
            requestId,
            limite,
        });
        res.json(logs);
    });

    router.get("/:id", async (req: Request, res: Response) => {
        const id = lerId(req.params.id, "id");
        const registro = await repo.buscarPorId(id);
        if (!registro) throw new ErroNaoEncontrado(`Registro de auditoria ${id} não encontrado`);
        res.json(registro);
    });

    return router;
}
