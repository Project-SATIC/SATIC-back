import { comTransacao, type QueryExecutor } from "../db/connection.ts";
import {
    AlocacaoRepository,
    SalaRepository,
    TurmaRepository,
} from "../db/repositories/index.ts";
import { ErroValidacao } from "../shared/erros.ts";
import { StateSpaceSearch } from "./state-space-search.ts";
import type { Alocacao, Turma } from "../shared/tipos.ts";

export const LIMITE_MAXIMO_NOS = 5_000_000;

export interface OpcoesGeracaoAlocacao {
    semestre?: string;
    persistir?: boolean;
    limiteNos?: number;
    semSalas?: string[];
}

export interface ResumoAlocacaoResponse {
    completo: boolean;
    totalTurmas: number;
    alocadas: number;
    pendentes: number;
    podas: number;
    nosVisitados: number;
    tempoMs: number;
}

export interface RespostaGeracaoAlocacao {
    sucesso: boolean;
    semestre: string;
    persistido: boolean;
    resumo: ResumoAlocacaoResponse;
    alocacoes: Alocacao[];
    pendentes: Turma[];
}

export type ExecutorTransacaoAlocador = <T>(fn: (executor?: QueryExecutor) => Promise<T>) => Promise<T>;

export class AlocadorService {
    readonly #turmaRepo: TurmaRepository;
    readonly #salaRepo: SalaRepository;
    readonly #alocacaoRepo: AlocacaoRepository;
    readonly #executarTransacao: ExecutorTransacaoAlocador;

    constructor(
        turmaRepo = new TurmaRepository(),
        salaRepo = new SalaRepository(),
        alocacaoRepo = new AlocacaoRepository(),
        executarTransacao?: ExecutorTransacaoAlocador
    ) {
        this.#turmaRepo = turmaRepo;
        this.#salaRepo = salaRepo;
        this.#alocacaoRepo = alocacaoRepo;

        const usaRepositoriosReais =
            turmaRepo instanceof TurmaRepository &&
            salaRepo instanceof SalaRepository &&
            alocacaoRepo instanceof AlocacaoRepository;

        this.#executarTransacao =
            executarTransacao ??
            (usaRepositoriosReais
                ? <T>(fn: (executor?: QueryExecutor) => Promise<T>) => comTransacao((client) => fn(client))
                : <T>(fn: (executor?: QueryExecutor) => Promise<T>) => fn(undefined));
    }

    async gerarAlocacao(opcoes: OpcoesGeracaoAlocacao = {}): Promise<RespostaGeracaoAlocacao> {
        let semestre = "2026.2";
        if (opcoes.semestre !== undefined) {
            if (typeof opcoes.semestre !== "string" || opcoes.semestre.trim() === "") {
                throw new ErroValidacao("Campo 'semestre' deve ser uma string não vazia");
            }
            semestre = opcoes.semestre.trim();
        }

        const persistir = opcoes.persistir ?? true;
        if (typeof persistir !== "boolean") {
            throw new ErroValidacao("Campo 'persistir' deve ser booleano");
        }

        if (opcoes.limiteNos !== undefined) {
            if (
                typeof opcoes.limiteNos !== "number" ||
                !Number.isInteger(opcoes.limiteNos) ||
                opcoes.limiteNos < 1 ||
                opcoes.limiteNos > LIMITE_MAXIMO_NOS
            ) {
                throw new ErroValidacao(
                    `Campo 'limiteNos' deve ser um inteiro entre 1 e ${LIMITE_MAXIMO_NOS}`
                );
            }
        }

        const semSalas = new Set<string>();
        if (opcoes.semSalas !== undefined) {
            if (!Array.isArray(opcoes.semSalas)) {
                throw new ErroValidacao("Campo 'semSalas' deve ser uma lista de nomes de salas");
            }
            for (const item of opcoes.semSalas) {
                if (typeof item !== "string" || item.trim() === "") {
                    throw new ErroValidacao("Cada item em 'semSalas' deve ser uma string não vazia");
                }
                semSalas.add(item.trim().toLowerCase());
            }
        }

        const executar = async (tx?: QueryExecutor): Promise<RespostaGeracaoAlocacao> => {
            if (persistir && tx) {
                await tx.query("SELECT pg_advisory_xact_lock(hashtext($1));", [`satic:alocacao:${semestre}`]);
            }

            // 1. Carrega turmas do semestre
            const todasTurmas = await this.#turmaRepo.listarPorSemestre(semestre, tx);
            if (todasTurmas.length === 0) {
                throw new ErroValidacao(
                    `Nenhuma turma encontrada no banco para o semestre '${semestre}'. Execute o seed primeiro ('npm run db:seed').`
                );
            }

            // 2. Carrega salas do IC, filtrando eventuais salas removidas na simulação
            let salasAlocaveis = await this.#salaRepo.listarAlocaveisPeloIc(tx);
            if (semSalas.size > 0) {
                salasAlocaveis = salasAlocaveis.filter((s) => !semSalas.has(s.nome.toLowerCase()));
            }

            // 3. Separa turmas que requerem alocação no IC daquelas externas
            const turmasParaAlocar: Turma[] = [];
            const reservasFixas: Alocacao[] = [];

            const alocacoesExistentes = await this.#alocacaoRepo.listarPorSemestre(semestre, tx);
            const turmasExternasFixasIds = new Set<number>();
            for (const aloc of alocacoesExistentes) {
                if (aloc.status === "EXTERNA_FIXA") {
                    reservasFixas.push(aloc);
                    if (aloc.turma.id != null) {
                        turmasExternasFixasIds.add(aloc.turma.id);
                    }
                }
            }

            for (const t of todasTurmas) {
                if (t.requerAlocacaoIc && (t.id == null || !turmasExternasFixasIds.has(t.id))) {
                    turmasParaAlocar.push(t);
                }
            }

            // 4. Executa o algoritmo de busca em espaço de estados
            const search = new StateSpaceSearch(turmasParaAlocar, salasAlocaveis, reservasFixas, {
                maxNos: opcoes.limiteNos,
            });
            const resultado = search.solve();

            // 5. Persiste as alocações geradas no PostgreSQL de forma atômica, preservando EXTERNA_FIXA
            if (persistir) {
                await this.#alocacaoRepo.substituirPorSemestre(semestre, resultado.alocacoes, tx);
            }

            return {
                sucesso: true,
                semestre,
                persistido: persistir,
                resumo: {
                    completo: resultado.completo,
                    totalTurmas: turmasParaAlocar.length,
                    alocadas: resultado.alocacoes.length,
                    pendentes: resultado.turmasPendentes.length,
                    podas: resultado.podas,
                    nosVisitados: resultado.nosVisitados,
                    tempoMs: Number(resultado.tempoMs.toFixed(2)),
                },
                alocacoes: resultado.alocacoes,
                pendentes: resultado.turmasPendentes,
            };
        };

        if (persistir) {
            return this.#executarTransacao((tx) => executar(tx));
        }
        return executar(undefined);
    }
}
