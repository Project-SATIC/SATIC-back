import {
    AlocacaoRepository,
    SalaRepository,
    TurmaRepository,
} from "../db/repositories/index.ts";
import { StateSpaceSearch } from "./state-space-search.ts";
import type { Alocacao, Sala, Turma } from "../shared/tipos.ts";

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

export class AlocadorService {
    readonly #turmaRepo: TurmaRepository;
    readonly #salaRepo: SalaRepository;
    readonly #alocacaoRepo: AlocacaoRepository;

    constructor(
        turmaRepo = new TurmaRepository(),
        salaRepo = new SalaRepository(),
        alocacaoRepo = new AlocacaoRepository()
    ) {
        this.#turmaRepo = turmaRepo;
        this.#salaRepo = salaRepo;
        this.#alocacaoRepo = alocacaoRepo;
    }

    async gerarAlocacao(opcoes: OpcoesGeracaoAlocacao = {}): Promise<RespostaGeracaoAlocacao> {
        const semestre = opcoes.semestre || "2026.2";
        const persistir = opcoes.persistir ?? true;
        const semSalas = new Set((opcoes.semSalas || []).map((s) => s.trim().toLowerCase()));

        // 1. Carrega turmas do semestre
        const todasTurmas = await this.#turmaRepo.listarPorSemestre(semestre);
        if (todasTurmas.length === 0) {
            throw new Error(`Nenhuma turma encontrada no banco para o semestre '${semestre}'. Execute o seed primeiro ('npm run db:seed').`);
        }

        // 2. Carrega salas do IC, filtrando eventuais salas removidas na simulação
        let salasAlocaveis = await this.#salaRepo.listarAlocaveisPeloIc();
        if (semSalas.size > 0) {
            salasAlocaveis = salasAlocaveis.filter((s) => !semSalas.has(s.nome.toLowerCase()));
        }

        // 3. Separa turmas que requerem alocação no IC daquelas externas
        const turmasParaAlocar: Turma[] = [];
        const reservasFixas: Alocacao[] = [];

        // Carrega alocações fixas externas prévias salvas no banco
        const alocacoesExistentes = await this.#alocacaoRepo.listarPorSemestre(semestre);
        for (const aloc of alocacoesExistentes) {
            if (aloc.status === "EXTERNA_FIXA") {
                reservasFixas.push(aloc);
            }
        }

        for (const t of todasTurmas) {
            if (t.requerAlocacaoIc) {
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
            await this.#alocacaoRepo.substituirPorSemestre(semestre, resultado.alocacoes);
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
    }
}
