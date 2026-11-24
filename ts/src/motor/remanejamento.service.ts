import {
    AlocacaoRepository,
    SalaRepository,
    TurmaRepository,
} from "../db/repositories/index.ts";
import { bloquearSemestre, comTransacao, executorPadrao, type Executor, type ExecutorTransacional } from "../db/connection.ts";
import { lerHorarioOpcional, lerId, lerStatusOpcional } from "../entrada.ts";
import { ErroNaoEncontrado, ErroRequisicao } from "../erros.ts";
import { diagnosticarViolacoes, ordenarSalasSoftConstraint, verificarCapacidade, verificarDisponibilidadeSala, verificarRequisitoLab, type Violacao } from "../shared/validador.ts";
import { mesmaTurma, numeroAlunos } from "../shared/tipos.ts";
import type { Alocacao, Sala, StatusAlocacao, Turma } from "../shared/tipos.ts";

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
     * "Confirmar tudo": aplica uma lista de movimentos numa transação, validando o ESTADO FINAL.
     *
     * Validar um movimento por vez contra o banco recusaria trocas (A vai para a sala de B e B para
     * a de A: cada um bate no outro, que ainda não saiu). Por isso todos os movimentos são aplicados
     * em memória; cada um é checado contra esse resultado; os inválidos saem e a checagem se repete
     * até estabilizar (sair um pode invalidar quem dependia dele). Só os aceitos são gravados.
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

            // Estado atual (todas as turmas dos semestres envolvidos)
            const base: Alocacao[] = [];
            for (const semestre of new Set([...turmas.values()].map((t) => t.semestre))) {
                base.push(...await this.#alocacaoRepo.listarPorSemestre(semestre, db));
            }
            // Último movimento de cada turma vale (o rascunho do front já manda um por turma)
            const porTurma = new Map<number, (typeof lidos)[number]>();
            for (const l of lidos) porTurma.set(l.mov.turmaId, l);

            const atuaisPorTurma = new Map(base.map((a) => [a.turma.id, a]));
            interface Plano { l: (typeof lidos)[number]; turma: Turma; sala: Sala | null; horario: string; origemSala?: OrigemSala; violacoes: Violacao[] }
            let candidatos: Plano[] = [];
            const recusados = new Map<number, Plano>();

            for (const l of porTurma.values()) {
                const turma = turmas.get(l.mov.turmaId)!;
                const existente = atuaisPorTurma.get(turma.id);
                if (l.remover && existente?.status === "EXTERNA_FIXA") {
                    recusados.set(l.indice, {
                        l,
                        turma,
                        sala: existente.sala,
                        horario: existente.horarioCodigo,
                        violacoes: [{ regra: "EXTERNA_FIXA", mensagem: "Reservas externas fixas (EXTERNA_FIXA) não podem ser removidas da grade." }],
                    });
                    continue;
                }
                candidatos.push({ l, turma, sala: null, horario: "", violacoes: [] });
            }

            const estadoCom = (planos: readonly Plano[], exceto?: Plano): Alocacao[] => {
                const movidas = new Set(planos.map((p) => p.turma.id));
                const resto = base.filter((a) => !movidas.has(a.turma.id));
                for (const p of planos) {
                    if (p === exceto || p.l.remover || !p.sala || p.violacoes.length > 0) continue;
                    const atual = atuaisPorTurma.get(p.turma.id);
                    resto.push({ id: atual?.id ?? null, turma: p.turma, sala: p.sala, horarioCodigo: p.horario, status: atual?.status ?? "RASCUNHO" });
                }
                return resto;
            };

            const maxRodadas = candidatos.length + 1;
            for (let rodada = 0; rodada < maxRodadas && candidatos.length > 0; rodada++) {
                for (const p of candidatos) {
                    p.sala = null;
                    p.horario = "";
                    p.origemSala = undefined;
                    p.violacoes = [];
                }
                // 1. Sala e horário de cada movimento, vendo os outros já aplicados (sala explícita antes da automática)
                const ordemResolucao = [
                    ...candidatos.filter((p) => !p.l.remover && p.l.mov.salaId != null),
                    ...candidatos.filter((p) => !p.l.remover && p.l.mov.salaId == null),
                ];
                for (const p of ordemResolucao) {
                    const outros = estadoCom(candidatos, p);
                    const atual = atuaisPorTurma.get(p.turma.id);
                    const r = await this.#resolver(p.turma, p.l.mov, atual ? [...outros, atual] : outros, db);
                    Object.assign(p, { sala: r.sala, horario: r.horario, origemSala: r.origemSala ?? undefined, violacoes: r.valida ? [] : r.violacoes });
                }
                // 2. Cada movimento válido no passo 1 contra o estado final com todos os aceitos aplicados
                const final = estadoCom(candidatos);
                for (const p of candidatos) {
                    if (p.l.remover || !p.sala || p.violacoes.length > 0) continue;
                    const v = diagnosticarViolacoes(p.turma, p.sala, final, p.horario);
                    if (v.length > 0) p.violacoes = v;
                }
                const invalidos = candidatos.filter((p) => !p.l.remover && (p.violacoes.length > 0 || !p.sala));
                if (invalidos.length === 0) break;
                for (const p of invalidos) recusados.set(p.l.indice, p);
                candidatos = candidatos.filter((p) => !invalidos.includes(p));
            }

            // 3. Grava só os aceitos
            const resultados = new Map<number, ResultadoItemLote>();
            for (const p of candidatos) {
                const turmaId = p.turma.id ?? null;
                const existente = atuaisPorTurma.get(p.turma.id);
                if (p.l.remover) {
                    resultados.set(p.l.indice, { ...await this.#remover(p.turma, db, existente), indice: p.l.indice, turmaId });
                    continue;
                }
                const status: StatusAlocacao = p.l.status ?? (existente?.status === "EXTERNA_FIXA" ? "EXTERNA_FIXA" : "DEFINITIVA");
                let alocacao: Alocacao;
                if (existente && existente.id != null) {
                    await this.#alocacaoRepo.atualizarSalaEHorario(existente.id, p.sala!.id!, p.horario, status, db);
                    alocacao = { ...existente, turma: p.turma, sala: p.sala!, horarioCodigo: p.horario, status };
                } else {
                    alocacao = await this.#alocacaoRepo.inserir({ turma: p.turma, sala: p.sala!, horarioCodigo: p.horario, status }, db);
                }
                resultados.set(p.l.indice, { sucesso: true, mensagem: "Alocação gravada.", alocacao, origemSala: p.origemSala, indice: p.l.indice, turmaId });
            }
            for (const p of recusados.values()) {
                resultados.set(p.l.indice, {
                    sucesso: false,
                    mensagem: "Remanejamento recusado pelo servidor: uma ou mais regras de negócio foram violadas.",
                    violacoes: p.violacoes.length ? p.violacoes : [{ regra: "SALA", mensagem: "Nenhuma sala compatível livre." }],
                    indice: p.l.indice,
                    turmaId: p.turma.id ?? null,
                });
            }
            // Movimentos repetidos da mesma turma: só o último vale e herda o resultado dele
            for (const l of lidos) {
                if (!resultados.has(l.indice)) {
                    const finalDaTurma = porTurma.get(l.mov.turmaId)!;
                    const resFinal = resultados.get(finalDaTurma.indice);
                    const sucesso = resFinal?.sucesso ?? false;
                    resultados.set(l.indice, {
                        sucesso,
                        mensagem: sucesso
                            ? "Substituído por um movimento posterior da mesma turma."
                            : "Substituído por um movimento posterior da mesma turma, que foi recusado.",
                        indice: l.indice,
                        turmaId: l.mov.turmaId,
                    });
                }
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

    async #remover(turma: Turma, db: Executor, existente?: Alocacao): Promise<ResultadoConfirmacao> {
        if (existente?.status === "EXTERNA_FIXA") {
            return {
                sucesso: false,
                mensagem: "Remanejamento recusado pelo servidor: uma ou mais regras de negócio foram violadas.",
                violacoes: [{ regra: "EXTERNA_FIXA", mensagem: "Reservas externas fixas (EXTERNA_FIXA) não podem ser removidas da grade." }],
            };
        }
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
            .filter((s) => verificarDisponibilidadeSala(s) && verificarCapacidade(turma, s) && verificarRequisitoLab(turma, s))
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
