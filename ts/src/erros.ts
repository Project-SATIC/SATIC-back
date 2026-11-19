/**
 * Erros de aplicação com status HTTP associado.
 *
 * Os serviços lançam estes erros e o handler global do Express (src/api/app.ts) os converte
 * em respostas JSON `{ erro, detalhes }`. Assim as rotas não precisam adivinhar o status
 * procurando trechos da mensagem.
 */
export class ErroHttp extends Error {
    readonly status: number;
    readonly detalhes?: unknown;

    constructor(status: number, mensagem: string, detalhes?: unknown) {
        super(mensagem);
        this.name = "ErroHttp";
        this.status = status;
        this.detalhes = detalhes;
    }
}

/** 400: payload ou parâmetro inválido. */
export class ErroRequisicao extends ErroHttp {
    constructor(mensagem: string, detalhes?: unknown) {
        super(400, mensagem, detalhes);
        this.name = "ErroRequisicao";
    }
}

/** 404: recurso inexistente. */
export class ErroNaoEncontrado extends ErroHttp {
    constructor(mensagem: string) {
        super(404, mensagem);
        this.name = "ErroNaoEncontrado";
    }
}

/** 409: estado do banco impede a operação. */
export class ErroConflito extends ErroHttp {
    constructor(mensagem: string, detalhes?: unknown) {
        super(409, mensagem, detalhes);
        this.name = "ErroConflito";
    }
}
