import { executorPadrao, type Executor } from "../connection.ts";
import { obterAutorAtual, obterRequestIdAtual } from "../../logger.ts";

export type OperacaoAuditoria =
    | "INSERT"
    | "UPDATE"
    | "DELETE"
    | "PUBLICACAO"
    | "DESPUBLICACAO"
    | "GERACAO_MOTOR"
    | "LOTE";

export interface RegistroAuditoria {
    id: number;
    entidade: string;
    entidadeId: string;
    operacao: OperacaoAuditoria;
    autor: string;
    requestId: string | null;
    dadosAnteriores: Record<string, unknown> | null;
    dadosNovos: Record<string, unknown> | null;
    criadoEm: string;
}

export interface NovoRegistroAuditoria {
    entidade: string;
    entidadeId: string | number;
    operacao: OperacaoAuditoria;
    autor?: string;
    requestId?: string | null;
    dadosAnteriores?: Record<string, unknown> | null;
    dadosNovos?: Record<string, unknown> | null;
}

export interface FiltrosAuditoria {
    entidade?: string;
    entidadeId?: string;
    operacao?: string;
    autor?: string;
    requestId?: string;
    limite?: number;
}

interface AuditoriaRow {
    id: number | string;
    entidade: string;
    entidade_id: string;
    operacao: OperacaoAuditoria;
    autor: string;
    request_id: string | null;
    dados_anteriores: Record<string, unknown> | null;
    dados_novos: Record<string, unknown> | null;
    criado_em: Date | string;
}

function paraIso(data: Date | string): string {
    return data instanceof Date ? data.toISOString() : String(data);
}

function mapearLinha(r: AuditoriaRow): RegistroAuditoria {
    return {
        id: Number(r.id),
        entidade: r.entidade,
        entidadeId: r.entidade_id,
        operacao: r.operacao,
        autor: r.autor,
        requestId: r.request_id ?? null,
        dadosAnteriores: r.dados_anteriores ?? null,
        dadosNovos: r.dados_novos ?? null,
        criadoEm: paraIso(r.criado_em),
    };
}

export class AuditoriaRepository {
    async registrar(evento: NovoRegistroAuditoria, db: Executor = executorPadrao): Promise<RegistroAuditoria> {
        const autor = evento.autor ?? obterAutorAtual();
        const requestId = evento.requestId !== undefined ? evento.requestId : obterRequestIdAtual();
        const res = await db.query<AuditoriaRow>(
            `INSERT INTO auditoria_log (entidade, entidade_id, operacao, autor, request_id, dados_anteriores, dados_novos)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, entidade, entidade_id, operacao, autor, request_id, dados_anteriores, dados_novos, criado_em;`,
            [
                evento.entidade,
                String(evento.entidadeId),
                evento.operacao,
                autor,
                requestId,
                evento.dadosAnteriores ? JSON.stringify(evento.dadosAnteriores) : null,
                evento.dadosNovos ? JSON.stringify(evento.dadosNovos) : null,
            ],
        );
        return mapearLinha(res.rows[0]);
    }

    async buscarPorId(id: number, db: Executor = executorPadrao): Promise<RegistroAuditoria | null> {
        const res = await db.query<AuditoriaRow>(
            `SELECT id, entidade, entidade_id, operacao, autor, request_id, dados_anteriores, dados_novos, criado_em
             FROM auditoria_log
             WHERE id = $1;`,
            [id],
        );
        return res.rows[0] ? mapearLinha(res.rows[0]) : null;
    }

    async listar(filtros: FiltrosAuditoria = {}, db: Executor = executorPadrao): Promise<RegistroAuditoria[]> {
        const condicoes: string[] = [];
        const params: unknown[] = [];

        if (filtros.entidade) {
            params.push(filtros.entidade);
            condicoes.push(`entidade = $${params.length}`);
        }
        if (filtros.entidadeId) {
            params.push(filtros.entidadeId);
            condicoes.push(`entidade_id = $${params.length}`);
        }
        if (filtros.operacao) {
            params.push(filtros.operacao);
            condicoes.push(`operacao = $${params.length}`);
        }
        if (filtros.autor) {
            params.push(filtros.autor);
            condicoes.push(`autor = $${params.length}`);
        }
        if (filtros.requestId) {
            params.push(filtros.requestId);
            condicoes.push(`request_id = $${params.length}`);
        }

        const limite = Math.max(1, Math.min(filtros.limite ?? 50, 500));
        params.push(limite);

        const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";
        const res = await db.query<AuditoriaRow>(
            `SELECT id, entidade, entidade_id, operacao, autor, request_id, dados_anteriores, dados_novos, criado_em
             FROM auditoria_log
             ${where}
             ORDER BY criado_em DESC, id DESC
             LIMIT $${params.length};`,
            params,
        );
        return res.rows.map(mapearLinha);
    }
}
