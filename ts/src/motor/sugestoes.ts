/**
 * Motor de sugestões para conflitos: escolhe HORÁRIO e SALA em aulas de 50 min (decisão de 19/11/2026).
 *
 * Retoma a ideia do protótipo original (github.com/VictorSamyr/state-space-search), que atribuía
 * horários às turmas, e a soma ao motor de salas atual (StateSpaceSearch: MRV + Best-Fit), que
 * continua intacto e com os gabaritos do Java.
 *
 * Nada é aplicado: o resultado são sugestões que o front mostra e, se aceitas, envia para
 * POST /api/alocacoes/confirmar-lote. Turmas DEFINITIVA (confirmadas) e EXTERNA_FIXA nunca mudam.
 *
 * Etapas, da mudança mais barata para a mais cara (trocar sala < mudar horário):
 *  A. Só salas: as turmas-alvo (em conflito ou pendentes) são redistribuídas nas salas pelo
 *     StateSpaceSearch, com as demais alocações fixas.
 *  B. Horário + sala: para o que sobrar, gera horários candidatos no mesmo formato (tamanhos de
 *     bloco) e nos turnos do curso, do mais parecido com o atual para o menos, e escolhe o
 *     primeiro sem choque de docente/indisponibilidade que tenha sala livre (Best-Fit).
 *  C. Mexer em outra turma: se ainda não couber, tenta liberar uma sala movendo de sala
 *     (sem mudar horário) uma turma RASCUNHO que não estava em conflito.
 * Todas as etapas têm limite de nós: a busca é heurística e não garante o mínimo absoluto.
 *
 * Módulo puro (sem banco): o SugestoesService carrega os dados e chama `sugerirResolucoes`.
 */
import { FormatoHorarioInvalidoError, obterConjuntoSlots } from "../shared/horario-sigaa.ts";
import {
    AULAS_POR_TURNO, DIAS_GRADE, aulasDoHorario, blocosDoHorario, formatoDoHorario, idAula,
    montarHorarioSigaa, turnosPermitidos, verificarFormatoHorario,
    type Aula,
} from "../shared/grade.ts";
import { chaveTurma, mesmaTurma } from "../shared/tipos.ts";
import type { Alocacao, DiaSemana, Sala, Turma } from "../shared/tipos.ts";
import {
    diagnosticarViolacoes, ordenarSalasSoftConstraint, verificarCapacidade, verificarChoqueProfessor, verificarChoqueSala,
    verificarEscopoEspacial, verificarIndisponibilidade, verificarRequisitoLab, type Violacao,
} from "../shared/validador.ts";
import { StateSpaceSearch } from "./state-space-search.ts";

export interface OpcoesSugestao {
    /** Turmas a resolver; padrão: todas as em conflito + pendentes com horário e docente. */
    alvos?: readonly number[];
    /** Turmas que podem mudar de formato (ex.: 2+2 -> 4 num dia). Busca bem maior. */
    permitirMudarFormato?: readonly number[];
    /** Limite total de nós (padrão 200.000). */
    limiteNos?: number;
    /** Alternativas por turma para a Central de Conflitos (padrão 3). */
    maxAlternativas?: number;
}

export interface Mudanca {
    turmaId: number;
    turma: string;
    tipo: "sala" | "horario" | "horario+sala" | "nova";
    de: { salaId: number | null; sala: string | null; horario: string };
    para: { salaId: number; sala: string; horario: string };
}

export interface Custo {
    turmasAlteradas: number;
    mudancasDeHorario: number;
    mudancasDeSala: number;
    /** Ordem de preferência: horário pesa 10, sala 1 (trocar sala < mudar horário). */
    pontos: number;
}

export interface Sugestao {
    descricao: string;
    mudancas: Mudanca[];
    custo: Custo;
}

export interface ConflitoTurma {
    turmaId: number;
    turma: string;
    status: string;
    violacoes: Violacao[];
}

export interface ResultadoSugestoes {
    conflitos: ConflitoTurma[];
    /** Pendentes: sem sala, sem horário ou sem docente. */
    pendentes: { turmaId: number; turma: string; motivo: string }[];
    alvos: number[];
    /** Plano que resolve o máximo de alvos juntos (null se nada foi resolvido). */
    plano: Sugestao | null;
    /** Opções independentes para cada alvo (cada uma considera as demais turmas como estão). */
    alternativasPorTurma: Record<number, Sugestao[]>;
    naoResolvidos: { turmaId: number; turma: string; motivo: string }[];
    nosVisitados: number;
    limiteAtingido: boolean;
    tempoMs: number;
}

export const LIMITE_NOS_SUGESTOES = 200_000;
const MAX_CANDIDATOS_HORARIO = 5_000;

const IMUTAVEIS = new Set(["DEFINITIVA", "EXTERNA_FIXA"]);

function horarioLegivel(h: string | null | undefined): boolean {
    if (h == null || h.trim() === "") return true;
    try {
        obterConjuntoSlots(h);
        return true;
    } catch (err) {
        if (err instanceof FormatoHorarioInvalidoError) return false;
        throw err;
    }
}

function slotsSeguro(h: string | null | undefined): ReadonlySet<string> {
    if (h == null || h.trim() === "") return new Set();
    try {
        return obterConjuntoSlots(h);
    } catch (err) {
        if (err instanceof FormatoHorarioInvalidoError) return new Set();
        throw err;
    }
}

function aulasSeguro(h: string | null | undefined): Aula[] {
    try {
        return aulasDoHorario(h);
    } catch (err) {
        if (err instanceof FormatoHorarioInvalidoError) return [];
        throw err;
    }
}

/** Horário efetivo: o da alocação (pode ter sido remanejado) ou o da pré-grade. */
function horarioEfetivo(turma: Turma, alocacao: Alocacao | undefined): string {
    return alocacao?.horarioCodigo ?? turma.horarioSigaa ?? "";
}

function comHorario(turma: Turma, horario: string): Turma {
    return { ...turma, horarioSigaa: horario };
}

function custoDe(mudancas: readonly Mudanca[]): Custo {
    const horario = mudancas.filter((m) => m.tipo === "horario" || m.tipo === "horario+sala").length;
    const sala = mudancas.filter((m) => m.tipo === "sala" || m.tipo === "horario+sala" || m.tipo === "nova").length;
    return { turmasAlteradas: mudancas.length, mudancasDeHorario: horario, mudancasDeSala: sala, pontos: horario * 10 + sala };
}

function descrever(m: Mudanca): string {
    if (m.tipo === "nova") return `${m.turma}: alocar em ${m.para.sala} (${m.para.horario})`;
    if (m.tipo === "sala") return `${m.turma}: ${m.de.sala ?? "sem sala"} → ${m.para.sala}`;
    return `${m.turma}: ${m.de.horario}${m.de.sala ? ` · ${m.de.sala}` : ""} → ${m.para.horario} · ${m.para.sala}`;
}

function sugestao(mudancas: Mudanca[]): Sugestao {
    return { descricao: mudancas.map(descrever).join("; "), mudancas, custo: custoDe(mudancas) };
}

function mudanca(turma: Turma, atual: Alocacao | undefined, sala: Sala, horario: string): Mudanca {
    const deHorario = horarioEfetivo(turma, atual);
    const mudouHorario = deHorario !== horario;
    const mudouSala = !atual || atual.sala.id !== sala.id;
    const tipo: Mudanca["tipo"] = !atual ? "nova" : mudouHorario && mudouSala ? "horario+sala" : mudouHorario ? "horario" : "sala";
    return {
        turmaId: turma.id!,
        turma: chaveTurma(turma),
        tipo,
        de: { salaId: atual?.sala.id ?? null, sala: atual?.sala.nome ?? null, horario: deHorario },
        para: { salaId: sala.id!, sala: sala.nome, horario },
    };
}

/**
 * Horários candidatos para uma turma, do mais parecido com o atual para o menos parecido.
 * Mesmo formato (tamanhos de bloco) por padrão; com `mudarFormato`, qualquer divisão das aulas
 * em blocos de até 6 (ou 4 à noite). Um bloco por dia, só nos turnos do curso, SEG–SEX
 * (SAB só se a turma já tinha aula no sábado).
 */
export function gerarHorariosCandidatos(turma: Turma, horarioAtual: string, mudarFormato = false): string[] {
    const aulasAtuais = aulasSeguro(horarioAtual);
    const total = turma.aulasSemanais ?? aulasAtuais.length;
    if (total <= 0) return [];
    const turnos = turnosPermitidos(turma);
    const maxBloco = Math.max(...turnos.map((t) => AULAS_POR_TURNO[t]));
    const dias = DIAS_GRADE.filter((d) => d !== "SAB" || aulasAtuais.some((a) => a.dia === "SAB"));

    const formatos: number[][] = [];
    const formatoAtual = aulasAtuais.length === total && aulasAtuais.length > 0 ? formatoDoHorario(horarioAtual) : [];
    if (formatoAtual.length > 0) formatos.push(formatoAtual);
    if (mudarFormato || formatoAtual.length === 0) {
        // Partições de `total` em partes decrescentes de até maxBloco, no máximo uma por dia
        const gerar = (resto: number, max: number, atual: number[]) => {
            if (resto === 0) { formatos.push([...atual]); return; }
            if (atual.length >= dias.length) return;
            for (let p = Math.min(max, resto); p >= 1; p--) gerar(resto - p, p, [...atual, p]);
        };
        gerar(total, maxBloco, []);
    }

    const vistos = new Set<string>();
    const resultado: string[] = [];
    // O limite é dividido entre os formatos: senão os primeiros esgotariam a cota e os outros
    // (ex.: 1+1+1+1) nunca seriam gerados
    const cotaPorFormato = Math.max(1, Math.floor(MAX_CANDIDATOS_HORARIO / Math.max(1, formatos.length)));
    let limiteAtual = 0;
    const atualSet = new Set(aulasAtuais.map(idAula));
    const diasAtuais = new Set(aulasAtuais.map((a) => a.dia));
    const turnosAtuais = new Set(aulasAtuais.map((a) => a.turno));

    for (const formato of formatos) {
        // Escolhe dias distintos para cada bloco (em ordem de dia para blocos de mesmo tamanho)
        limiteAtual = resultado.length + cotaPorFormato;
        const escolher = (i: number, diasUsados: DiaSemana[], aulas: Aula[]) => {
            if (resultado.length >= limiteAtual) return;
            if (i === formato.length) {
                const h = montarHorarioSigaa(aulas);
                if (!vistos.has(h)) { vistos.add(h); resultado.push(h); }
                return;
            }
            const tamanho = formato[i];
            const minDia = i > 0 && formato[i - 1] === tamanho ? dias.indexOf(diasUsados[i - 1]) + 1 : 0;
            for (let d = minDia; d < dias.length; d++) {
                const dia = dias[d];
                if (diasUsados.includes(dia)) continue;
                for (const turno of turnos) {
                    for (let inicio = 1; inicio + tamanho - 1 <= AULAS_POR_TURNO[turno]; inicio++) {
                        const bloco: Aula[] = [];
                        for (let k = 0; k < tamanho; k++) bloco.push({ dia, turno, indice: inicio + k });
                        escolher(i + 1, [...diasUsados, dia], [...aulas, ...bloco]);
                    }
                }
            }
        };
        escolher(0, [], []);
    }

    const parecenca = (h: string) => {
        const aulas = aulasDoHorario(h);
        const iguais = aulas.filter((a) => atualSet.has(idAula(a))).length;
        const mesmosDias = new Set(aulas.map((a) => a.dia).filter((d) => diasAtuais.has(d))).size;
        const mesmoTurno = aulas.filter((a) => turnosAtuais.has(a.turno)).length;
        return iguais * 100 + mesmosDias * 10 + mesmoTurno;
    };
    const pontuados = resultado.filter((h) => h !== horarioAtual).map((h) => ({ h, p: parecenca(h) }));
    pontuados.sort((a, b) => b.p - a.p || a.h.localeCompare(b.h));
    return pontuados.map((x) => x.h);
}

interface Estado {
    alocacoes: Alocacao[];
}

/** Melhor sala livre (Best-Fit, preservando laboratórios) para a turma no horário, ou null. */
function salaLivre(turma: Turma, horario: string, salas: readonly Sala[], estado: Estado, excluir?: Set<number>): Sala | null {
    const t = comHorario(turma, horario);
    const candidatas = salas
        .filter((s) => !excluir?.has(s.id!) && verificarCapacidade(t, s) && verificarRequisitoLab(t, s) && verificarEscopoEspacial(t, s))
        .sort(ordenarSalasSoftConstraint(t));
    return candidatas.find((s) => verificarChoqueSala(t, s, estado.alocacoes, horario)) ?? null;
}

/** RN-01, RN-02 e formato: o que só se resolve mudando o horário. */
function horarioAceitavel(turma: Turma, horario: string, estado: Estado): boolean {
    if (!horarioLegivel(horario)) return false;
    const t = comHorario(turma, horario);
    return verificarIndisponibilidade(t, horario)
        && verificarChoqueProfessor(t, estado.alocacoes, horario)
        && verificarFormatoHorario(turma, horario).length === 0;
}

export function sugerirResolucoes(
    turmas: readonly Turma[],
    salasDoPool: readonly Sala[],
    alocacoes: readonly Alocacao[],
    opcoes: OpcoesSugestao = {},
): ResultadoSugestoes {
    const inicio = performance.now();
    const limite = opcoes.limiteNos ?? LIMITE_NOS_SUGESTOES;
    const maxAlt = opcoes.maxAlternativas ?? 3;
    const mudarFormato = new Set(opcoes.permitirMudarFormato ?? []);
    let nos = 0;
    const gastar = (n = 1) => { nos += n; return nos <= limite; };

    const alocPorTurma = new Map<number, Alocacao>();
    for (const a of alocacoes) if (a.turma.id != null) alocPorTurma.set(a.turma.id, a);
    const alocacoesLegiveis = alocacoes.filter((a) => horarioLegivel(a.horarioCodigo));

    // 1. Conflitos atuais e pendências
    const conflitos: ConflitoTurma[] = [];
    for (const a of alocacoes) {
        if (a.status === "EXTERNA_FIXA") continue;
        if (!horarioLegivel(a.horarioCodigo)) {
            const v = diagnosticarViolacoes(a.turma, a.sala, alocacoesLegiveis, "");
            v.push({ regra: "FORMATO", mensagem: `Horário SIGAA ilegível: '${a.horarioCodigo}'.` });
            conflitos.push({ turmaId: a.turma.id!, turma: chaveTurma(a.turma), status: a.status, violacoes: v });
            continue;
        }
        const v = diagnosticarViolacoes(a.turma, a.sala, alocacoesLegiveis, a.horarioCodigo);
        if (v.length > 0) conflitos.push({ turmaId: a.turma.id!, turma: chaveTurma(a.turma), status: a.status, violacoes: v });
    }
    const pendentes: ResultadoSugestoes["pendentes"] = [];
    for (const t of turmas) {
        if (!t.requerAlocacaoIc || alocPorTurma.has(t.id!)) continue;
        const motivo = !t.horarioSigaa || slotsSeguro(t.horarioSigaa).size === 0 ? "sem horário"
            : t.professores.length === 0 ? "sem docente" : "sem sala";
        pendentes.push({ turmaId: t.id!, turma: chaveTurma(t), motivo });
    }

    // 2. Alvos: conflitos que o motor pode mexer + pendentes resolvíveis (com horário e docente)
    const naoResolvidos: ResultadoSugestoes["naoResolvidos"] = [];
    const padrao = [
        ...conflitos.filter((c) => !IMUTAVEIS.has(c.status)).map((c) => c.turmaId),
        ...pendentes.filter((p) => p.motivo === "sem sala").map((p) => p.turmaId),
    ];
    for (const p of pendentes.filter((x) => x.motivo !== "sem sala")) {
        naoResolvidos.push({ turmaId: p.turmaId, turma: p.turma, motivo: `pendente ${p.motivo}: preencha antes de rodar o motor` });
    }
    const alvos = [...new Set((opcoes.alvos ?? padrao).map(Number))].filter((id) => {
        const a = alocPorTurma.get(id);
        return !a || !IMUTAVEIS.has(a.status);
    });
    const turmaPorId = new Map(turmas.map((t) => [t.id!, t]));
    const alvosTurmas = alvos.map((id) => turmaPorId.get(id)).filter((t): t is Turma => !!t);

    const fixas = alocacoesLegiveis.filter((a) => !alvos.includes(a.turma.id!));
    const estado: Estado = { alocacoes: [...fixas] };
    const planoMudancas: Mudanca[] = [];
    const resolvidos = new Set<number>();

    // Quem mantém o horário: das maiores para as menores, cada alvo fica no horário atual se ele
    // não bate (docente, indisponibilidade, formato) com as fixas nem com os alvos já mantidos.
    // Assim, num choque de docente entre uma turma de 16 aulas e uma de 4, a de 4 é que muda.
    const referencia: Estado = { alocacoes: [...fixas] };
    const comHorarioValido: Turma[] = [];
    const ordemManter = [...alvosTurmas].sort((a, b) => (b.aulasSemanais ?? 0) - (a.aulasSemanais ?? 0) || a.id! - b.id!);
    for (const t of ordemManter) {
        const atual = alocPorTurma.get(t.id!);
        const h = horarioEfetivo(t, atual);
        if (slotsSeguro(h).size === 0 || !horarioAceitavel(t, h, referencia)) continue;
        comHorarioValido.push(t);
        referencia.alocacoes.push({ turma: t, sala: atual?.sala ?? salasDoPool[0], horarioCodigo: h, status: "RASCUNHO" });
    }

    // Etapa A: só salas, com o motor atual (MRV + Best-Fit), para quem mantém o horário
    if (comHorarioValido.length > 0) {
        const clones = comHorarioValido.map((t) => comHorario(t, horarioEfetivo(t, alocPorTurma.get(t.id!))));
        const busca = new StateSpaceSearch(clones, salasDoPool, estado.alocacoes, { maxNos: Math.max(1, Math.floor(limite / 2)) });
        const r = busca.solve();
        gastar(r.nosVisitados);
        for (const a of r.alocacoes) {
            const original = turmaPorId.get(a.turma.id!)!;
            const atual = alocPorTurma.get(a.turma.id!);
            estado.alocacoes.push({ ...a, turma: original });
            if (!atual || atual.sala.id !== a.sala.id) planoMudancas.push(mudanca(original, atual, a.sala, a.horarioCodigo));
            resolvidos.add(a.turma.id!);
        }
    }

    // Etapa B: horário + sala para os que não couberam. Turmas menores primeiro: mudar uma turma
    // de 2 aulas incomoda menos que mudar uma de 16, e costuma desfazer o choque das duas.
    // Cada turma testa antes o horário atual: se a outra ponta do choque já mudou, basta uma sala.
    const restantes = alvosTurmas.filter((t) => !resolvidos.has(t.id!))
        .sort((a, b) => (a.aulasSemanais ?? 0) - (b.aulasSemanais ?? 0) || a.id! - b.id!);
    for (const t of restantes) {
        if (nos > limite) break;
        const atual = alocPorTurma.get(t.id!);
        const hAtual = horarioEfetivo(t, atual);
        const candidatos = [hAtual, ...gerarHorariosCandidatos(t, hAtual, mudarFormato.has(t.id!))]
            .filter((h) => slotsSeguro(h).size > 0);
        for (const h of candidatos) {
            if (!gastar()) break;
            if (!horarioAceitavel(t, h, estado)) continue;
            // Mesma hora: prefere continuar na sala atual se ela ficou livre
            const manterSala = atual && h === hAtual && verificarChoqueSala(comHorario(t, h), atual.sala, estado.alocacoes, h)
                && verificarCapacidade(t, atual.sala) && verificarRequisitoLab(t, atual.sala) && verificarEscopoEspacial(t, atual.sala);
            const sala = manterSala ? atual!.sala : salaLivre(t, h, salasDoPool, estado);
            if (!sala) continue;
            estado.alocacoes.push({ turma: t, sala, horarioCodigo: h, status: "RASCUNHO" });
            if (!(atual && atual.sala.id === sala.id && h === hAtual)) planoMudancas.push(mudanca(t, atual, sala, h));
            resolvidos.add(t.id!);
            break;
        }
    }

    // Etapa C: liberar uma sala movendo (só de sala) uma turma RASCUNHO que não era alvo
    for (const t of alvosTurmas.filter((x) => !resolvidos.has(x.id!))) {
        if (nos > limite) break;
        const atual = alocPorTurma.get(t.id!);
        const horarios = [horarioEfetivo(t, atual), ...gerarHorariosCandidatos(t, horarioEfetivo(t, atual), mudarFormato.has(t.id!))]
            .filter((h) => slotsSeguro(h).size > 0);
        let feito = false;
        for (const h of horarios) {
            if (feito || !gastar()) break;
            if (!horarioAceitavel(t, h, estado)) continue;
            const tH = comHorario(t, h);
            const salasCompativeis = salasDoPool
                .filter((s) => verificarCapacidade(tH, s) && verificarRequisitoLab(tH, s) && verificarEscopoEspacial(tH, s))
                .sort(ordenarSalasSoftConstraint(tH));
            for (const s of salasCompativeis) {
                if (!gastar()) break;
                const slotsH = slotsSeguro(h);
                const ocupantes = estado.alocacoes.filter((a) => {
                    if (a.sala.id !== s.id || mesmaTurma(a.turma, t)) return false;
                    const slotsA = slotsSeguro(a.horarioCodigo);
                    return slotsA.size > 0 && [...slotsH].some((x) => slotsA.has(x));
                });
                if (ocupantes.length !== 1) continue;
                const o = ocupantes[0];
                if (IMUTAVEIS.has(o.status) || planoMudancas.some((m) => m.turmaId === o.turma.id)) continue;
                const semOcupante: Estado = { alocacoes: estado.alocacoes.filter((a) => a !== o) };
                const comAlvo: Estado = { alocacoes: [...semOcupante.alocacoes, { turma: t, sala: s, horarioCodigo: h, status: "RASCUNHO" }] };
                const novaSalaOcupante = salaLivre(o.turma, o.horarioCodigo, salasDoPool, comAlvo, new Set([s.id!]));
                if (!novaSalaOcupante) continue;
                estado.alocacoes = [...comAlvo.alocacoes, { ...o, sala: novaSalaOcupante }];
                planoMudancas.push(mudanca(t, atual, s, h), mudanca(o.turma, o, novaSalaOcupante, o.horarioCodigo));
                resolvidos.add(t.id!);
                feito = true;
                break;
            }
        }
    }

    for (const a of estado.alocacoes) {
        if (a.status !== "DEFINITIVA") continue;
        const v = horarioLegivel(a.horarioCodigo)
            ? diagnosticarViolacoes(a.turma, a.sala, estado.alocacoes, a.horarioCodigo)
            : [{ regra: "FORMATO" as const, mensagem: `Horário SIGAA ilegível: '${a.horarioCodigo}'.` }];
        if (v.length > 0) {
            const regras = [...new Set(v.map((x) => x.regra))].join(", ");
            naoResolvidos.push({
                turmaId: a.turma.id!,
                turma: chaveTurma(a.turma),
                motivo: `turma confirmada continua em conflito (${regras}): exige decisão manual`,
            });
        }
    }
    for (const t of alvosTurmas.filter((x) => !resolvidos.has(x.id!))) {
        const atual = alocPorTurma.get(t.id!);
        const motivo = conflitos.find((c) => c.turmaId === t.id)?.violacoes.map((v) => v.regra).join(", ") ?? "sem sala";
        naoResolvidos.push({ turmaId: t.id!, turma: chaveTurma(t), motivo: `nenhuma combinação encontrada dentro do limite (${motivo}${atual ? "" : ", pendente"})` });
    }

    // Alternativas por turma: cada alvo isolado, com as demais turmas como estão hoje
    const alternativasPorTurma: Record<number, Sugestao[]> = {};
    for (const t of alvosTurmas) {
        if (nos > limite) break;
        const atual = alocPorTurma.get(t.id!);
        const outros: Estado = { alocacoes: alocacoesLegiveis.filter((a) => !mesmaTurma(a.turma, t)) };
        const opcoesT: Sugestao[] = [];
        const hAtual = horarioEfetivo(t, atual);
        // Primeiro: mesma hora, outra sala (mais barato)
        if (slotsSeguro(hAtual).size > 0 && horarioAceitavel(t, hAtual, outros)) {
            const tH = comHorario(t, hAtual);
            const salas = salasDoPool
                .filter((s) => s.id !== atual?.sala.id && verificarCapacidade(tH, s) && verificarRequisitoLab(tH, s) && verificarEscopoEspacial(tH, s)
                    && verificarChoqueSala(tH, s, outros.alocacoes, hAtual))
                .sort(ordenarSalasSoftConstraint(tH));
            for (const s of salas.slice(0, maxAlt)) opcoesT.push(sugestao([mudanca(t, atual, s, hAtual)]));
        }
        // Depois: outro horário
        if (opcoesT.length < maxAlt) {
            for (const h of gerarHorariosCandidatos(t, hAtual, mudarFormato.has(t.id!))) {
                if (opcoesT.length >= maxAlt || !gastar()) break;
                if (!horarioAceitavel(t, h, outros)) continue;
                const s = salaLivre(t, h, salasDoPool, outros);
                if (s) opcoesT.push(sugestao([mudanca(t, atual, s, h)]));
            }
        }
        alternativasPorTurma[t.id!] = opcoesT;
    }

    return {
        conflitos,
        pendentes,
        alvos,
        plano: planoMudancas.length > 0 ? sugestao(planoMudancas) : null,
        alternativasPorTurma,
        naoResolvidos,
        nosVisitados: nos,
        limiteAtingido: nos > limite,
        tempoMs: Math.max(1, Math.round(performance.now() - inicio)),
    };
}

/** Turnos e blocos de um horário, para mensagens: "TER M3–M4, QUI M3–M4". */
export function descreverHorario(horario: string): string {
    return blocosDoHorario(horario).map((b) => `${b.dia} ${b.turno}${b.inicio}${b.fim !== b.inicio ? `–${b.turno}${b.fim}` : ""}`).join(", ");
}
