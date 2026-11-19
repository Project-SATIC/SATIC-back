/**
 * Amostra da oferta real 2026.2 para testes manuais (decisão de 19/11/2026).
 *
 * Com as 95 turmas fica difícil provocar e acompanhar uma regra à mão. Estas 17 turmas reais
 * (mesmos horários SIGAA, docentes e salas de origem) foram escolhidas para que cada regra
 * tenha pelo menos um caso fácil de testar na grade. As 19 salas continuam todas.
 *
 *   npm run local:amostra      banco local só com a amostra (pasta ts/.pglite-amostra)
 *   npm run db:seed -- --amostra   seed da amostra num PostgreSQL de verdade
 */
import { OFERTAS_2026_2 } from "./ofertas-2026-2.ts";
import type { OfertaRegistro } from "./seeder.ts";

export interface TurmaDaAmostra {
    chave: string;
    motivo: string;
}

export const AMOSTRA_2026_2: readonly TurmaDaAmostra[] = Object.freeze([
    // RN-02 e RN-01: Ranilson tem indisponibilidade SEX T5–T6 (seed) e duas turmas
    { chave: "COMP370-01", motivo: "RN-02: docente indisponível SEX T5–T6; mesmo docente da COMP373-02 (RN-01)" },
    { chave: "COMP373-02", motivo: "Laboratório; mesmo docente da COMP370-01 (RN-01)" },
    // Co-docência N:M
    { chave: "COMP382-01", motivo: "Co-docência com 4 docentes, 16 aulas (2345M3456)" },
    { chave: "COMP361-01", motivo: "Docente também em COMP382-01: mover para M3–M6 de SEG–QUI dá RN-01" },
    { chave: "COMP359-01", motivo: "4 aulas seguidas num dia (6M3456), laboratório, 60 alunos; docente também em COMP382-01" },
    { chave: "ECOM013-01", motivo: "Co-docência com 2 docentes em laboratório, 4 aulas num dia (6T1234)" },
    // Formatos de horário
    { chave: "ECOM015-01", motivo: "4 aulas seguidas num dia (4M3456), laboratório pequeno (21 alunos)" },
    { chave: "ECOM036-01", motivo: "Horário diferente em cada dia (2T56 6T12)" },
    { chave: "ECOM030-01", motivo: "Blocos de tamanhos diferentes (5M12 6M3456)" },
    { chave: "COMP384-02", motivo: "Aula no sábado (7M45)" },
    { chave: "COMP377-01", motivo: "Um único bloco de 2 aulas (2M34); mesma docente da COMP383-01" },
    { chave: "COMP383-01", motivo: "Um único bloco de 2 aulas (2T12); mesma docente da COMP377-01" },
    // Capacidade e turma conjunta
    { chave: "CPT0035-01", motivo: "Turma conjunta CC + EC com 75 alunos: só cabe nas maiores salas (RN-03)" },
    // Curso noturno
    { chave: "IART001-01", motivo: "IA à noite (4N1234), co-docência; turno da noite só para IA" },
    { chave: "IART002-01", motivo: "IA à noite em laboratório (2N1234)" },
    // Reservas externas fixas
    { chave: "IF0001-05", motivo: "Turma do IF com reserva EXTERNA_FIXA na Sala 207 BL12 (24T12)" },
    { chave: "FALE0002-03", motivo: "Turma da FALE com reserva EXTERNA_FIXA no Auditório CEPETEC (5T1234)" },
]);

/** Registros brutos da oferta só das turmas da amostra (turmas conjuntas trazem um registro por curso). */
export function ofertasDaAmostra(ofertas: readonly OfertaRegistro[] = OFERTAS_2026_2): OfertaRegistro[] {
    const chaves = new Set(AMOSTRA_2026_2.map((t) => t.chave));
    return ofertas.filter((o) => chaves.has(`${o.codigoDisciplina}-${o.codigoTurma}`));
}
