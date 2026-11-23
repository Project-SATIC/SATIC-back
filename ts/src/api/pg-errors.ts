import type { Response } from "express";
import { formatarErro } from "../db/connection.ts";
import { ErroConflito, ErroNaoEncontrado, ErroValidacao } from "../shared/erros.ts";

interface PgLikeError {
    code?: string;
    detail?: string;
    constraint?: string;
    message?: string;
}

export function responderErroBanco(
    res: Response,
    err: unknown,
    mensagemPadrao: string,
    contexto: "escrita" | "remocao" | "leitura" = "escrita"
): void {
    const detalhes = formatarErro(err);

    if (err instanceof ErroValidacao) {
        res.status(400).json({ erro: mensagemPadrao, detalhes });
        return;
    }

    if (err instanceof ErroNaoEncontrado) {
        res.status(404).json({ erro: mensagemPadrao, detalhes });
        return;
    }

    if (err instanceof ErroConflito) {
        res.status(409).json({ erro: mensagemPadrao, detalhes });
        return;
    }

    const pgErr = err as PgLikeError | undefined;
    const code = pgErr?.code;

    if (code === "23505") {
        res.status(409).json({
            erro: `${mensagemPadrao}: registro duplicado`,
            detalhes: pgErr?.detail || detalhes,
        });
        return;
    }

    if (code === "23503") {
        const status = contexto === "remocao" ? 409 : 400;
        const motivo =
            contexto === "remocao"
                ? "registro está referenciado por outros dados"
                : "referência informada não existe";
        res.status(status).json({
            erro: `${mensagemPadrao}: ${motivo}`,
            detalhes: pgErr?.detail || detalhes,
        });
        return;
    }

    if (
        code === "23514" ||
        code === "23502" ||
        code === "22P02" ||
        code === "22001" ||
        code === "22003"
    ) {
        res.status(400).json({
            erro: `${mensagemPadrao}: dados inválidos`,
            detalhes: pgErr?.detail || detalhes,
        });
        return;
    }

    res.status(500).json({ erro: mensagemPadrao, detalhes });
}
