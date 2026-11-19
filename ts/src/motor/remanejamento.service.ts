import {
    AlocacaoRepository,
    SalaRepository,
    TurmaRepository,
} from "../db/repositories/index.ts";
import { bloquearSemestre, comTransacao, executorPadrao, type Executor, type ExecutorTransacional } from "../db/connection.ts";
import { lerHorarioOpcional, lerId, lerStatusOpcional } from "../entrada.ts";
import { ErroNaoEncontrado } from "../erros.ts";
import { diagnosticarViolacoes, type Violacao } from "../shared/validador.ts";
import type { Alocacao, Sala, StatusAlocacao, Turma } from "../shared/tipos.ts";

export interface RequisicaoValidacao {
    turmaId: unknown;
    salaId: unknown;
    /** Horário SIGAA pretendido; se omitido, usa o horarioSigaa da turma. */
    horario?: unknown;
}

export interface ResultadoValidacao {
    valida: boolean;
    turmaId: number;
    salaId: number;
    horario: string;
    violacoes: Violacao[];
}

export interface RequisicaoConfirmacao extends RequisicaoValidacao {
    status?: unknown;
}

export interface ResultadoConfirmacao {
    sucesso: boolean;
    mensagem: string;
    alocacao?: Alocacao;
    violacoes?: Violacao[];
}

interface MovimentoLido {
    turmaId: number;
    salaId: number;
    horario: string | undefined;
}

function lerMovimento(req: RequisicaoValidacao | null | undefined): MovimentoLido {
    const r = req ?? ({} as RequisicaoValidacao);
    return {
        turmaId: lerId(r.turmaId, "turmaId"),
        salaId: lerId(r.salaId, "salaId"),
        horario: lerHorarioOpcional(r.horario),
    };
}

export class RemanejamentoService {
    readonly #turmaRepo: TurmaRepository;
    readonly #salaRepo: SalaRepository;
    readonly #alocacaoRepo: AlocacaoRepository;
    readonly #transacao: ExecutorTransacional;
    readonly #db: Executor;

    constructor(
        turmaRepo = new TurmaRepository(),
        salaRepo = new SalaRepository(),
        alocacaoRepo = new AlocacaoRepository(),
        transacao: ExecutorTransacional = comTransacao,
        db: Executor = executorPadrao,
    ) {
        this.#turmaRepo = turmaRepo;
        this.#salaRepo = salaRepo;
        this.#alocacaoRepo = alocacaoRepo;
        this.#transacao = transacao;
        this.#db = db;
    }

    /** Valida um movimento sem gravar nada (feedback do drag-and-drop). */
    async validar(req: RequisicaoValidacao): Promise<ResultadoValidacao> {
        const mov = lerMovimento(req);
        const { turma, sala } = await this.#carregar(mov, this.#db);
        return this.#diagnosticar(turma, sala, mov.horario, this.#db);
    }

    /**
     * Revalida e grava o movimento. Validação e escrita rodam na mesma transação, com lock
     * do semestre: dois remanejamentos simultâneos não conseguem ocupar a mesma sala/horário.
     * Só a alocação da turma movida é alterada.
     */
    async confirmar(req: RequisicaoConfirmacao): Promise<ResultadoConfirmacao> {
        const mov = lerMovimento(req);
        const statusPedido = lerStatusOpcional(req?.status);

        return this.#transacao(async (db) => {
            const { turma, sala } = await this.#carregar(mov, db);
            // O semestre (chave do lock) vem da própria turma; o cliente não escolhe.
            // As alocações são lidas só depois do lock, já com o que outra transação tenha gravado.
            await bloquearSemestre(db, turma.semestre);
            const validacao = await this.#diagnosticar(turma, sala, mov.horario, db);

            if (!validacao.valida) {
                return {
                    sucesso: false,
                    mensagem: "Remanejamento recusado pelo servidor: uma ou mais regras de negócio foram violadas.",
                    violacoes: validacao.violacoes,
                };
            }

            const horario = validacao.horario;
            const existente = await this.#alocacaoRepo.buscarPorTurmaId(turma.id!, db);
            // Mover uma reserva externa não a transforma em alocação do IC, a menos que o cliente peça
            const status: StatusAlocacao = statusPedido ?? (existente?.status === "EXTERNA_FIXA" ? "EXTERNA_FIXA" : "DEFINITIVA");

            if (existente && existente.id != null) {
                await this.#alocacaoRepo.atualizarSalaEHorario(existente.id, sala.id!, horario, status, db);
                return {
                    sucesso: true,
                    mensagem: "Alocação remanejada e atualizada com sucesso.",
                    alocacao: { ...existente, turma, sala, horarioCodigo: horario, status },
                };
            }

            const salva = await this.#alocacaoRepo.inserir({ turma, sala, horarioCodigo: horario, status }, db);
            return {
                sucesso: true,
                mensagem: "Alocação confirmada e salva com sucesso.",
                alocacao: salva,
            };
        });
    }

    async #carregar(mov: MovimentoLido, db: Executor): Promise<{ turma: Turma; sala: Sala }> {
        const turma = await this.#turmaRepo.buscarPorId(mov.turmaId, db);
        if (!turma) throw new ErroNaoEncontrado(`Turma de ID ${mov.turmaId} não encontrada`);
        const sala = await this.#salaRepo.buscarPorId(mov.salaId, db);
        if (!sala) throw new ErroNaoEncontrado(`Sala de ID ${mov.salaId} não encontrada`);
        return { turma, sala };
    }

    async #diagnosticar(turma: Turma, sala: Sala, horarioPedido: string | undefined, db: Executor): Promise<ResultadoValidacao> {
        const horario = horarioPedido ?? turma.horarioSigaa;
        // Alocações do semestre com docentes hidratados (RN-01) e salas (choque de sala)
        const alocacoesAtuais = await this.#alocacaoRepo.listarPorSemestre(turma.semestre, db);
        const violacoes = diagnosticarViolacoes(turma, sala, alocacoesAtuais, horario);
        return { valida: violacoes.length === 0, turmaId: turma.id!, salaId: sala.id!, horario, violacoes };
    }
}
