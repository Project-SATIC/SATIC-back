import {
    AlocacaoRepository,
    SalaRepository,
    TurmaRepository,
} from "../db/repositories/index.ts";
import { bloquearSemestre, comTransacao, executorPadrao, type Executor, type ExecutorTransacional } from "../db/connection.ts";
import { lerHorarioOpcional, lerId, lerStatusOpcional } from "../entrada.ts";
import { ErroNaoEncontrado, ErroRequisicao } from "../erros.ts";
import { diagnosticarViolacoes, verificarCapacidade, verificarRequisitoLab, type Violacao } from "../shared/validador.ts";
import { mesmaTurma, numeroAlunos } from "../shared/tipos.ts";
import type { Alocacao, Sala, StatusAlocacao, Turma } from "../shared/tipos.ts";
import { ordenarSalasSoftConstraint } from "./state-space-search.ts";

export interface RequisicaoValidacao {
    turmaId: unknown;
    /** Sala pretendida. Se omitida, o servidor mantém a sala atual (se continuar válida) ou sugere a melhor livre. */
    salaId?: unknown;
    /** Horário SIGAA pretendido; se omitido, usa o horário atual da alocação ou o horarioSigaa da turma. */
    horario?: unknown;
}

/** De onde veio a sala do resultado. */
export type OrigemSala = "pedida" | "mantida" | "sugerida";

export interface ResultadoValidacao {
    valida: boolean;
    turmaId: number;
    salaId: number | null;
    sala: Sala | null;
    origemSala: OrigemSala | null;
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
    origemSala?: OrigemSala;
    violacoes?: Violacao[];
}

/** Um item do "Confirmar tudo". `acao: "remover"` tira a turma da grade (ela volta a ser pendente). */
export interface MovimentoLote extends RequisicaoConfirmacao {
    acao?: unknown;
}

export interface ResultadoItemLote extends ResultadoConfirmacao {
    indice: number;
    turmaId: number | null;
}

export interface ResultadoLote {
    aceitos: number;
    recusados: number;
    resultados: ResultadoItemLote[];
}

export const LIMITE_MOVIMENTOS_LOTE = 200;

interface MovimentoLido {
    turmaId: number;
    salaId: number | undefined;
    horario: string | undefined;
}

function lerMovimento(req: RequisicaoValidacao | null | undefined): MovimentoLido {
    const r = req ?? ({} as RequisicaoValidacao);
    const salaInformada = r.salaId != null && r.salaId !== "";
    return {
        turmaId: lerId(r.turmaId, "turmaId"),
        salaId: salaInformada ? lerId(r.salaId, "salaId") : undefined,
        horario: lerHorarioOpcional(r.horario),
    };
}

/** Violações que não dependem da sala: mudar de sala não resolve. */
const REGRAS_INDEPENDENTES_DE_SALA = new Set(["RN-01", "RN-02", "FORMATO", "TURNO"]);

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
        const turma = await this.#carregarTurma(mov.turmaId, this.#db);
        const alocacoes = await this.#alocacaoRepo.listarPorSemestre(turma.semestre, this.#db);
        return this.#resolver(turma, mov, alocacoes, this.#db);
    }

    /**
     * Revalida e grava um movimento. Validação e escrita rodam na mesma transação, com lock
     * do semestre: dois remanejamentos simultâneos não conseguem ocupar a mesma sala/horário.
     * Só a alocação da turma movida é alterada.
     */
    async confirmar(req: RequisicaoConfirmacao): Promise<ResultadoConfirmacao> {
        const mov = lerMovimento(req);
        const statusPedido = lerStatusOpcional(req?.status);
        return this.#transacao(async (db) => {
            const turma = await this.#carregarTurma(mov.turmaId, db);
            // O semestre (chave do lock) vem da própria turma; o cliente não escolhe.
            // As alocações são lidas só depois do lock, já com o que outra transação tenha gravado.
            await bloquearSemestre(db, turma.semestre);
            return this.#aplicar(turma, mov, statusPedido, db);
        });
    }

    /**
     * "Confirmar tudo": aplica uma lista de movimentos numa transação. Cada movimento é validado
     * contra o estado que já inclui os anteriores aceitos; os recusados não impedem os demais.
     * Os recusados ganham uma segunda tentativa no fim (ex.: troca de salas entre duas turmas,
     * em que a primeira só cabe depois que a segunda sai).
     */
    async confirmarLote(movimentos: unknown): Promise<ResultadoLote> {
        if (!Array.isArray(movimentos) || movimentos.length === 0) {
            throw new ErroRequisicao("movimentos deve ser uma lista não vazia");
        }
        if (movimentos.length > LIMITE_MOVIMENTOS_LOTE) {
            throw new ErroRequisicao(`no máximo ${LIMITE_MOVIMENTOS_LOTE} movimentos por confirmação`);
        }
        // Lê tudo antes de abrir a transação: um item malformado recusa o lote inteiro (400)
        const lidos = movimentos.map((m, indice) => {
            const item = (m ?? {}) as MovimentoLote;
            if (item.acao != null && item.acao !== "mover" && item.acao !== "remover") {
                throw new ErroRequisicao(`movimentos[${indice}].acao deve ser "mover" ou "remover"`);
            }
            try {
                return { indice, remover: item.acao === "remover", mov: lerMovimento(item), status: lerStatusOpcional(item.status) };
            } catch (err) {
                if (err instanceof ErroRequisicao) throw new ErroRequisicao(`movimentos[${indice}]: ${err.message}`);
                throw err;
            }
        });

        return this.#transacao(async (db) => {
            const turmas = new Map<number, Turma>();
            for (const l of lidos) {
                if (!turmas.has(l.mov.turmaId)) turmas.set(l.mov.turmaId, await this.#carregarTurma(l.mov.turmaId, db));
            }
            // Lock de cada semestre envolvido, em ordem fixa (evita deadlock entre lotes)
            for (const semestre of [...new Set([...turmas.values()].map((t) => t.semestre))].sort()) {
                await bloquearSemestre(db, semestre);
            }

            const resultados = new Map<number, ResultadoItemLote>();
            let pendentes = lidos;
            for (let passada = 0; passada < 2 && pendentes.length > 0; passada++) {
                const recusados: typeof lidos = [];
                for (const l of pendentes) {
                    const turma = turmas.get(l.mov.turmaId)!;
                    const r = l.remover ? await this.#remover(turma, db) : await this.#aplicar(turma, l.mov, l.status, db);
                    resultados.set(l.indice, { ...r, indice: l.indice, turmaId: turma.id ?? null });
                    if (!r.sucesso) recusados.push(l);
                }
                if (recusados.length === pendentes.length) break; // nenhum progresso: não adianta repetir
                pendentes = recusados;
            }

            const lista = [...resultados.values()].sort((a, b) => a.indice - b.indice);
            const aceitos = lista.filter((r) => r.sucesso).length;
            return { aceitos, recusados: lista.length - aceitos, resultados: lista };
        });
    }

    async #aplicar(turma: Turma, mov: MovimentoLido, statusPedido: StatusAlocacao | undefined, db: Executor): Promise<ResultadoConfirmacao> {
        const alocacoes = await this.#alocacaoRepo.listarPorSemestre(turma.semestre, db);
        const validacao = await this.#resolver(turma, mov, alocacoes, db);
        if (!validacao.valida || !validacao.sala) {
            return {
                sucesso: false,
                mensagem: "Remanejamento recusado pelo servidor: uma ou mais regras de negócio foram violadas.",
                violacoes: validacao.violacoes,
            };
        }

        const sala = validacao.sala;
        const horario = validacao.horario;
        const existente = alocacoes.find((a) => mesmaTurma(a.turma, turma));
        // Mover uma reserva externa não a transforma em alocação do IC, a menos que o cliente peça
        const status: StatusAlocacao = statusPedido ?? (existente?.status === "EXTERNA_FIXA" ? "EXTERNA_FIXA" : "DEFINITIVA");
        const origemSala = validacao.origemSala ?? undefined;

        if (existente && existente.id != null) {
            await this.#alocacaoRepo.atualizarSalaEHorario(existente.id, sala.id!, horario, status, db);
            return {
                sucesso: true,
                mensagem: "Alocação remanejada e atualizada com sucesso.",
                alocacao: { ...existente, turma, sala, horarioCodigo: horario, status },
                origemSala,
            };
        }

        const salva = await this.#alocacaoRepo.inserir({ turma, sala, horarioCodigo: horario, status }, db);
        return { sucesso: true, mensagem: "Alocação confirmada e salva com sucesso.", alocacao: salva, origemSala };
    }

    async #remover(turma: Turma, db: Executor): Promise<ResultadoConfirmacao> {
        const removidas = await this.#alocacaoRepo.removerPorTurmaId(turma.id!, db);
        return removidas > 0
            ? { sucesso: true, mensagem: "Turma retirada da grade; agora está pendente." }
            : { sucesso: true, mensagem: "A turma já não estava na grade." };
    }

    /**
     * Decide a sala e diagnostica o movimento:
     *  - sala pedida pelo cliente: só valida;
     *  - sem sala pedida: mantém a sala atual se continuar válida no novo horário; senão sugere a
     *    melhor sala livre pelo mesmo critério do motor (não-laboratório para teóricas, Best-Fit).
     */
    async #resolver(turma: Turma, mov: MovimentoLido, alocacoes: readonly Alocacao[], db: Executor): Promise<ResultadoValidacao> {
        const atual = alocacoes.find((a) => mesmaTurma(a.turma, turma));
        const horario = mov.horario ?? atual?.horarioCodigo ?? turma.horarioSigaa;
        const base = { turmaId: turma.id!, horario };

        if (!horario || horario.trim() === "") {
            return { ...base, valida: false, salaId: null, sala: null, origemSala: null,
                violacoes: [{ regra: "FORMATO", mensagem: "A turma está sem horário: informe o horário antes de confirmar." }] };
        }

        if (mov.salaId != null) {
            const sala = await this.#salaRepo.buscarPorId(mov.salaId, db);
            if (!sala) throw new ErroNaoEncontrado(`Sala de ID ${mov.salaId} não encontrada`);
            const violacoes = diagnosticarViolacoes(turma, sala, alocacoes, horario);
            return { ...base, valida: violacoes.length === 0, salaId: sala.id!, sala, origemSala: "pedida", violacoes };
        }

        if (atual) {
            const violacoes = diagnosticarViolacoes(turma, atual.sala, alocacoes, horario);
            if (violacoes.length === 0) {
                return { ...base, valida: true, salaId: atual.sala.id!, sala: atual.sala, origemSala: "mantida", violacoes };
            }
        }

        const pool = turma.requerAlocacaoIc ? await this.#salaRepo.listarAlocaveisPeloIc(db) : await this.#salaRepo.listarTodas(db);
        const candidatas = pool
            .filter((s) => verificarCapacidade(turma, s) && verificarRequisitoLab(turma, s))
            .sort(ordenarSalasSoftConstraint(turma));
        for (const sala of candidatas) {
            const violacoes = diagnosticarViolacoes(turma, sala, alocacoes, horario);
            if (violacoes.length === 0) {
                return { ...base, valida: true, salaId: sala.id!, sala, origemSala: "sugerida", violacoes };
            }
        }

        // Nenhuma sala serve: explica o que não depende de sala e por que nenhuma sala está livre
        const referencia = atual?.sala ?? candidatas[0];
        const independentes = referencia
            ? diagnosticarViolacoes(turma, referencia, alocacoes, horario).filter((v) => REGRAS_INDEPENDENTES_DE_SALA.has(v.regra))
            : [];
        const motivoSala: Violacao = candidatas.length === 0
            ? { regra: "RN-03", mensagem: `Nenhuma sala ${turma.disciplina.exigeLaboratorio ? "de laboratório " : ""}comporta ${numeroAlunos(turma)} alunos.` }
            : { regra: "SALA", mensagem: `Nenhuma das ${candidatas.length} sala(s) compatíveis está livre no horário ${horario}.` };
        // Se o problema não depende da sala (ex.: choque de docente), dizer "nenhuma sala livre" só confunde
        const violacoes = independentes.length > 0 ? independentes : [motivoSala];
        return { ...base, valida: false, salaId: null, sala: null, origemSala: null, violacoes };
    }

    async #carregarTurma(turmaId: number, db: Executor): Promise<Turma> {
        const turma = await this.#turmaRepo.buscarPorId(turmaId, db);
        if (!turma) throw new ErroNaoEncontrado(`Turma de ID ${turmaId} não encontrada`);
        return turma;
    }
}
