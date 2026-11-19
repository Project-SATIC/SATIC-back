/**
 * Integração contra um PostgreSQL de verdade: o PGlite (PostgreSQL compilado para WebAssembly)
 * exposto em uma porta local pelo pglite-socket, acessado pelo mesmo driver `pg` da API.
 *
 * Executa as migrations e o seed reais, o motor pelo banco, os remanejamentos e as rotas HTTP.
 * Limitações do PGlite (não do PostgreSQL):
 *  - uma única sessão: o pool usa 1 conexão (PGPOOL_MAX=1) e a disputa entre transações
 *    concorrentes não é exercitada aqui (só a ordem lock -> leitura, em integracao-banco.test.ts);
 *  - o pglite-socket fecha a conexão depois de qualquer erro de SQL. Os testes que esperam erro
 *    usam `esperarErroSql`, que descarta a conexão morta antes de seguir.
 */
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type AddressInfo, type Server as NetServer } from "node:net";
import type { Server } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const gabarito = JSON.parse(readFileSync(new URL("./fixtures/golden-java-2026-2.json", import.meta.url), "utf8"));

async function portaLivre(): Promise<number> {
    const srv: NetServer = createServer();
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
    const { port } = srv.address() as AddressInfo;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
    return port;
}

describe("PostgreSQL real (PGlite): migrations, seed, motor, remanejamento e API", () => {
    let pglite: PGlite;
    let socket: PGLiteSocketServer;
    let http: Server;
    let api = "";
    // Módulos importados depois de configurar o ambiente (o pool lê PG* na primeira consulta)
    let m: {
        conn: typeof import("../src/db/connection.ts");
        migrator: typeof import("../src/db/migrator.ts");
        seed: typeof import("../src/seed/db-seeder.ts");
        repos: typeof import("../src/db/repositories/index.ts");
        alocador: typeof import("../src/motor/alocador.service.ts");
        remanejamento: typeof import("../src/motor/remanejamento.service.ts");
        app: typeof import("../src/api/app.ts");
        tipos: typeof import("../src/shared/tipos.ts");
    };

    const sql = async <R = Record<string, unknown>>(texto: string, params?: unknown[]) =>
        (await m.conn.query(texto, params)).rows as R[];
    const idTurma = async (disc: string, cod: string) =>
        (await sql<{ id: number }>("SELECT id FROM turma WHERE id_disciplina = $1 AND codigo_turma = $2", [disc, cod]))[0].id;
    const idSala = async (nome: string) => (await sql<{ id: number }>("SELECT id FROM sala WHERE nome = $1", [nome]))[0].id;
    const esperarErroSql = async (fn: () => Promise<unknown>, padrao: RegExp) => {
        await assert.rejects(fn, padrao);
        // pglite-socket derruba a conexão após o erro: a próxima consulta falha uma vez e o pool reconecta
        await m.conn.query("SELECT 1").catch(() => undefined);
    };
    const contarStatus = async () => Object.fromEntries(
        (await sql<{ status: string; n: number }>("SELECT status, COUNT(*)::int AS n FROM alocacao GROUP BY status ORDER BY status"))
            .map((r) => [r.status, r.n]),
    );

    before(async () => {
        const porta = await portaLivre();
        pglite = await PGlite.create();
        socket = new PGLiteSocketServer({ db: pglite, port: porta, host: "127.0.0.1" });
        await socket.start();

        delete process.env.DATABASE_URL;
        Object.assign(process.env, {
            PGHOST: "127.0.0.1", PGPORT: String(porta), PGUSER: "postgres", PGPASSWORD: "postgres",
            PGDATABASE: "postgres", PGPOOL_MAX: "1",
        });

        m = {
            conn: await import("../src/db/connection.ts"),
            migrator: await import("../src/db/migrator.ts"),
            seed: await import("../src/seed/db-seeder.ts"),
            repos: await import("../src/db/repositories/index.ts"),
            alocador: await import("../src/motor/alocador.service.ts"),
            remanejamento: await import("../src/motor/remanejamento.service.ts"),
            app: await import("../src/api/app.ts"),
            tipos: await import("../src/shared/tipos.ts"),
        };

        const app = m.app.criarApp();
        await new Promise<void>((resolve) => { http = app.listen(0, "127.0.0.1", () => resolve()); });
        api = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    });

    after(async () => {
        await new Promise<void>((resolve) => http.close(() => resolve()));
        await m.conn.closePool();
        await socket.stop();
        await pglite.close();
    });

    test("migrations 001 a 003 aplicam e são idempotentes", async () => {
        const r1 = await m.migrator.executarMigrations();
        assert.deepEqual(r1.map((r) => [r.arquivo, r.status]), [
            ["001_criar_schema_inicial.sql", "aplicada"],
            ["002_integridade_alocacao.sql", "aplicada"],
            ["003_aulas_semanais_e_curso_ia.sql", "aplicada"],
        ]);
        const r2 = await m.migrator.executarMigrations();
        assert.ok(r2.every((r) => r.status === "ja_executada"));
        const restricoes = (await sql<{ conname: string }>("SELECT conname FROM pg_constraint WHERE conname LIKE 'uq_alocacao%' OR conname LIKE 'ck_%' ORDER BY conname")).map((r) => r.conname);
        assert.deepEqual(restricoes, [
            "ck_alocacao_status", "ck_disciplina_carga_horaria", "ck_professor_turma_carga",
            "ck_sala_capacidade", "ck_turma_aulas_semanais", "ck_turma_vagas", "uq_alocacao_turma",
        ]);
    });

    test("seed grava a base 2026.2 com as 2 reservas EXTERNA_FIXA e pode rodar de novo", async () => {
        const resumo = await m.seed.executarSeed();
        assert.equal(resumo.turmas, 95);
        assert.equal(resumo.reservasExternas, 2);
        await m.seed.executarSeed();
        const [{ n: turmas }] = await sql<{ n: number }>("SELECT COUNT(*)::int AS n FROM turma");
        assert.equal(turmas, 95, "seed idempotente: sem turmas duplicadas");
        assert.deepEqual(await contarStatus(), { EXTERNA_FIXA: 2 });
        const reservas = await sql<{ t: string; s: string }>(`
            SELECT t.id_disciplina || '-' || t.codigo_turma AS t, s.nome AS s
            FROM alocacao a JOIN turma t ON t.id = a.id_turma JOIN sala s ON s.id = a.id_sala ORDER BY 1`);
        assert.deepEqual(reservas, [{ t: "FALE0002-03", s: "Auditório CEPETEC" }, { t: "IF0001-05", s: "Sala 207 BL12" }]);
    });

    test("repositórios hidratam co-docência e indisponibilidades a partir do banco", async () => {
        const turmas = await new m.repos.TurmaRepository().listarPorSemestre("2026.2");
        assert.equal(turmas.length, 95);
        const comp382 = turmas.find((t) => m.tipos.chaveTurma(t) === "COMP382-01")!;
        assert.equal(comp382.professores.length, 4);
        assert.equal(Object.keys(comp382.cargaHorariaPorDocente).length, 4);
        const ranilson = turmas.flatMap((t) => t.professores).find((p) => p.matriculaSiape === "2024389")!;
        assert.deepEqual(ranilson.indisponibilidades.map((i) => [i.diaSemana, i.turno, i.indiceHorario]), [["SEX", "T", "56"]]);
        assert.equal(turmas.find((t) => m.tipos.chaveTurma(t) === "CPT0035-01")?.cursosOfertados, "CC, EC");
        // aulas por semana gravadas no cadastro e turmas IART como curso IA (noturno)
        assert.equal(comp382.aulasSemanais, 16);
        assert.equal(turmas.find((t) => m.tipos.chaveTurma(t) === "COMP360-01")?.aulasSemanais, 4);
        assert.deepEqual(turmas.filter((t) => t.disciplina.codigo.startsWith("IART")).map((t) => t.cursosOfertados), ["IA", "IA"]);

        const salas = await new m.repos.SalaRepository().listarAlocaveisPeloIc();
        // Ordem binária (bloco, nome), igual ao SQLite do Java
        assert.deepEqual(salas.slice(0, 3).map((s) => s.nome), ["Sala 206 BL12", "Sala 207 BL12", "Auditório CEPETEC"]);
    });

    test("motor pelo PostgreSQL reproduz o gabarito do Java", async () => {
        const r = await new m.alocador.AlocadorService().gerarAlocacao({ persistir: false });
        assert.equal(r.resumo.nosVisitados, gabarito.nosVisitados);
        assert.equal(r.resumo.podas, gabarito.podas);
        assert.deepEqual(r.pendentes.map(m.tipos.chaveTurma), gabarito.pendentes);
        assert.deepEqual(
            r.alocacoes.map((a) => ({ turma: m.tipos.chaveTurma(a.turma), sala: a.sala.nome, horario: a.horarioCodigo, status: a.status })),
            gabarito.alocacoes,
        );
    });

    test("POST /api/alocacoes/gerar grava 86 RASCUNHO numa transação e regerar mantém as reservas", async () => {
        for (let i = 0; i < 2; i++) {
            const res = await fetch(`${api}/api/alocacoes/gerar`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.resumo.alocadas, 86);
            assert.equal(body.resumo.preservadas, 2);
            assert.ok(body.alocacoes.every((a: { id: unknown }) => typeof a.id === "number"));
        }
        assert.deepEqual(await contarStatus(), { EXTERNA_FIXA: 2, RASCUNHO: 86 });
    });

    test("falha no meio da gravação desfaz tudo (ROLLBACK)", async () => {
        const antes = await contarStatus();
        const repo = new m.repos.AlocacaoRepository();
        // Delega ao repositório real, mas falha depois de gravar 10 das 86 alocações
        const quebrado = {
            listarPorSemestre: (s: string, db: never) => repo.listarPorSemestre(s, db),
            limparPorSemestre: (s: string, st: never, db: never) => repo.limparPorSemestre(s, st, db),
            inserirMuitas: async (alocs: never[], db: never) => {
                await repo.inserirMuitas(alocs.slice(0, 10), db);
                throw new Error("falha simulada no meio da gravação");
            },
        } as unknown as InstanceType<typeof m.repos.AlocacaoRepository>;
        const service = new m.alocador.AlocadorService(undefined, undefined, quebrado);
        await assert.rejects(() => service.gerarAlocacao({}), /falha simulada/);
        assert.deepEqual(await contarStatus(), antes, "nenhum rascunho apagado nem inserido pela metade");
    });

    test("GET /api/alocacoes devolve turmas com docentes (RN-01 disponível para o front)", async () => {
        const lista = await (await fetch(`${api}/api/alocacoes?semestre=2026.2`)).json();
        assert.equal(lista.length, 88);
        const comp382 = lista.find((a: { turma: { disciplina: { codigo: string } } }) => a.turma.disciplina.codigo === "COMP382");
        assert.equal(comp382.turma.professores.length, 4);
    });

    test("/validar e /confirmar contra o banco: RN-01 de co-docente, sucesso e preservação da DEFINITIVA", async () => {
        // COMP382-01 tem 4 docentes; pega um deles e uma outra turma dele (ou cria o vínculo) no mesmo horário
        const [alvo] = await sql<{ id: number; horario: string; sala: number; siape: string }>(`
            SELECT t.id, t.horario_sigaa AS horario, a.id_sala AS sala, pt.matricula_siape AS siape
            FROM turma t JOIN alocacao a ON a.id_turma = t.id JOIN professor_turma pt ON pt.id_turma = t.id
            WHERE t.id_disciplina = 'COMP382' AND t.codigo_turma = '01' LIMIT 1`);
        const outraId = await idTurma("COMP360", "01");
        const [outra] = await sql<{ horario: string }>("SELECT horario_sigaa AS horario FROM turma WHERE id = $1", [outraId]);

        // Movendo COMP382-01 para o horário de COMP360-01 numa sala livre: sem vínculo comum, não há RN-01
        const livre = await idSala("LCCV");
        const semChoque = await (await fetch(`${api}/api/alocacoes/validar`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ turmaId: alvo.id, salaId: livre, horario: "7M12" }),
        })).json();
        assert.equal(semChoque.violacoes.some((v: { regra: string }) => v.regra === "RN-01"), false);

        // Vincula um dos co-docentes de COMP382-01 a COMP360-01: agora o mesmo movimento colide (RN-01)
        await sql("INSERT INTO professor_turma (matricula_siape, id_turma, carga_horaria_professor) VALUES ($1, $2, 10) ON CONFLICT DO NOTHING", [alvo.siape, outraId]);
        try {
            const res = await fetch(`${api}/api/alocacoes/confirmar`, {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ turmaId: alvo.id, salaId: livre, horario: outra.horario }),
            });
            assert.equal(res.status, 409);
            const body = await res.json();
            assert.ok(body.violacoes.some((v: { regra: string }) => v.regra === "RN-01"), JSON.stringify(body.violacoes));
        } finally {
            await sql("DELETE FROM professor_turma WHERE matricula_siape = $1 AND id_turma = $2", [alvo.siape, outraId]);
        }

        // Movimento válido: COMP360-01 (24M34) para o LCCV
        const conf = await fetch(`${api}/api/alocacoes/confirmar`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ turmaId: outraId, salaId: livre }),
        });
        assert.equal(conf.status, 200, JSON.stringify(await conf.clone().json()));
        assert.deepEqual(await contarStatus(), { DEFINITIVA: 1, EXTERNA_FIXA: 2, RASCUNHO: 85 });

        // Nova geração preserva a DEFINITIVA
        const r = await new m.alocador.AlocadorService().gerarAlocacao({});
        assert.equal(r.resumo.preservadas, 3);
        const [atual] = await sql<{ sala: string; status: string }>(
            "SELECT s.nome AS sala, a.status FROM alocacao a JOIN sala s ON s.id = a.id_sala WHERE a.id_turma = $1", [outraId]);
        assert.deepEqual(atual, { sala: "LCCV", status: "DEFINITIVA" });
        assert.deepEqual(await contarStatus(), { DEFINITIVA: 1, EXTERNA_FIXA: 2, RASCUNHO: 85 });
    });

    test("choque de sala com outra turma já gravada é recusado com 409 e nada muda", async () => {
        const antes = await sql("SELECT id_turma, id_sala, horario_codigo, status FROM alocacao ORDER BY id_turma");
        // IF0001-05 ocupa a Sala 207 BL12 (EXTERNA_FIXA); tenta colocar outra turma lá no mesmo horário
        const [reserva] = await sql<{ horario: string; sala: number }>(`
            SELECT a.horario_codigo AS horario, a.id_sala AS sala FROM alocacao a JOIN turma t ON t.id = a.id_turma
            WHERE t.id_disciplina = 'IF0001' AND t.codigo_turma = '05'`);
        const t = await idTurma("COMP360", "01");
        const res = await fetch(`${api}/api/alocacoes/confirmar`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ turmaId: t, salaId: reserva.sala, horario: reserva.horario }),
        });
        assert.equal(res.status, 409);
        assert.ok((await res.json()).violacoes.some((v: { regra: string }) => v.regra === "SALA"));
        assert.deepEqual(await sql("SELECT id_turma, id_sala, horario_codigo, status FROM alocacao ORDER BY id_turma"), antes);
    });

    test("fluxo de conflito: /conflitos -> /sugestoes -> /confirmar-lote zera os conflitos", async () => {
        const json = async (caminho: string, corpo?: unknown) => {
            const res = await fetch(`${api}/api/alocacoes${caminho}`, corpo === undefined ? undefined
                : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
            return { status: res.status, body: await res.json() };
        };
        assert.deepEqual((await json("/conflitos?semestre=2026.2")).body.conflitos, []);

        // Cria um choque de sala direto no banco: duas turmas RASCUNHO com horário sobreposto na mesma sala
        const [par] = await sql<{ a: number; b: number; sala: number }>(`
            SELECT x.id_turma AS a, y.id_turma AS b, x.id_sala AS sala
            FROM alocacao x JOIN alocacao y ON x.id < y.id AND x.id_sala <> y.id_sala
            JOIN turma tx ON tx.id = x.id_turma JOIN turma ty ON ty.id = y.id_turma
            JOIN disciplina dy ON dy.codigo = ty.id_disciplina JOIN sala sx ON sx.id = x.id_sala
            WHERE x.status = 'RASCUNHO' AND y.status = 'RASCUNHO' AND x.horario_codigo = y.horario_codigo
              AND GREATEST(ty.matriculados, 1) <= sx.capacidade AND (NOT dy.exige_laboratorio OR sx.tipo_espaco = 'Laboratório')
            LIMIT 1`);
        assert.ok(par, "par de turmas no mesmo horário");
        await sql("UPDATE alocacao SET id_sala = $1 WHERE id_turma = $2", [par.sala, par.b]);

        const conf = await json("/conflitos?semestre=2026.2");
        assert.equal(conf.status, 200);
        assert.deepEqual(conf.body.conflitos.map((c: { turmaId: number }) => c.turmaId).sort(), [par.a, par.b].sort());

        const sug = await json("/sugestoes", { semestre: "2026.2" });
        assert.equal(sug.status, 200);
        assert.ok(sug.body.plano, JSON.stringify(sug.body.naoResolvidos));
        assert.equal(sug.body.plano.custo.mudancasDeHorario, 0, "choque só de sala se resolve sem mexer em horário");
        assert.ok(sug.body.alternativasPorTurma[par.a] || sug.body.alternativasPorTurma[par.b]);

        const movimentos = sug.body.plano.mudancas.map((m: { turmaId: number; para: { salaId: number; horario: string } }) =>
            ({ turmaId: m.turmaId, salaId: m.para.salaId, horario: m.para.horario }));
        const lote = await json("/confirmar-lote", { movimentos });
        assert.equal(lote.status, 200, JSON.stringify(lote.body));
        assert.deepEqual((await json("/conflitos?semestre=2026.2")).body.conflitos, []);
    });

    test("restrições do banco barram dados inválidos (defesa além da API)", async () => {
        const t = await idTurma("COMP360", "01");
        const s = await idSala("LCCV");
        await esperarErroSql(() => sql("INSERT INTO alocacao (id_turma, id_sala, horario_codigo) VALUES ($1, $2, '2M12')", [t, s]), /uq_alocacao_turma/);
        await esperarErroSql(() => sql("UPDATE alocacao SET status = 'APROVADA' WHERE id_turma = $1", [t]), /ck_alocacao_status/);
        await esperarErroSql(() => sql("UPDATE sala SET capacidade = 0 WHERE id = $1", [s]), /ck_sala_capacidade/);
        await esperarErroSql(() => sql("UPDATE turma SET vagas = -1 WHERE id = $1", [t]), /ck_turma_vagas/);
    });

    test("rotas de consulta respondem com dados do banco e 404/400 corretos", async () => {
        assert.equal((await fetch(`${api}/api/health`)).status, 200);
        const salas = await (await fetch(`${api}/api/salas?alocavel_ic=false`)).json();
        assert.ok(salas.length > 0 && salas.every((s: { alocavelIc: boolean }) => !s.alocavelIc));
        const t = await idTurma("COMP382", "01");
        assert.equal((await (await fetch(`${api}/api/turmas/${t}`)).json()).professores.length, 4);
        assert.equal((await fetch(`${api}/api/turmas/999999`)).status, 404);
        assert.equal((await fetch(`${api}/api/salas/999999`)).status, 404);
        assert.equal((await fetch(`${api}/api/professores/2024389`)).status, 200);
        assert.equal((await fetch(`${api}/api/disciplinas/comp382`)).status, 200);
        const turmasExternas = await (await fetch(`${api}/api/turmas?semestre=2026.2&requer_ic=false`)).json();
        assert.ok(turmasExternas.length >= 2);
    });

    test("migration 002 sobre banco com alocações duplicadas mantém só a mais recente", async () => {
        // Simula um banco criado só com a 001 e com duplicatas antigas
        await m.migrator.resetarBanco();
        const r = await m.migrator.executarMigrations();
        assert.equal(r.length, 3);
        await m.conn.query("DELETE FROM _migrations WHERE nome = '002_integridade_alocacao.sql'");
        await m.conn.query(`
            ALTER TABLE alocacao DROP CONSTRAINT uq_alocacao_turma;
            ALTER TABLE alocacao DROP CONSTRAINT ck_alocacao_status;
            ALTER TABLE sala DROP CONSTRAINT ck_sala_capacidade;
            ALTER TABLE disciplina DROP CONSTRAINT ck_disciplina_carga_horaria;
            ALTER TABLE turma DROP CONSTRAINT ck_turma_vagas;
            ALTER TABLE professor_turma DROP CONSTRAINT ck_professor_turma_carga;
            INSERT INTO sala (nome, capacidade) VALUES ('S', 10);
            INSERT INTO disciplina (codigo, nome, carga_horaria) VALUES ('D1', 'D', 60);
            INSERT INTO turma (id_disciplina, codigo_turma, semestre, cursos_ofertados, vagas, horario_sigaa) VALUES ('D1', '01', '2026.2', 'CC', 10, '2M12');
            INSERT INTO alocacao (id_turma, id_sala, horario_codigo) VALUES (1, 1, '2M12'), (1, 1, '3M12');
        `);
        await m.migrator.executarMigrations();
        assert.deepEqual(await sql("SELECT horario_codigo FROM alocacao"), [{ horario_codigo: "3M12" }]);
    });

    test("migration 003 preenche aulas por semana de turmas antigas e corrige IART para IA", async () => {
        // Banco que já tinha turmas antes da 003 (coluna ainda inexistente)
        await m.migrator.resetarBanco();
        await m.migrator.executarMigrations();
        await m.conn.query("DELETE FROM _migrations WHERE nome = '003_aulas_semanais_e_curso_ia.sql'");
        await m.conn.query(`
            ALTER TABLE turma DROP CONSTRAINT ck_turma_aulas_semanais;
            ALTER TABLE turma DROP COLUMN aulas_semanais;
            INSERT INTO disciplina (codigo, nome, carga_horaria) VALUES ('C1', 'C', 60), ('IART001', 'IA', 72);
            INSERT INTO turma (id_disciplina, codigo_turma, semestre, cursos_ofertados, vagas, horario_sigaa) VALUES
                ('C1', '01', '2026.2', 'CC', 10, '35M34'),
                ('C1', '02', '2026.2', 'CC', 10, '2T56 6T12'),
                ('C1', '03', '2026.2', 'CC', 10, '2345M3456'),
                ('C1', '04', '2026.2', 'CC', 10, ''),
                ('IART001', '01', '2026.2', 'CC', 10, '4N1234');
        `);
        await m.migrator.executarMigrations();
        assert.deepEqual(
            await sql("SELECT id_disciplina AS d, codigo_turma AS c, cursos_ofertados AS cursos, aulas_semanais AS n FROM turma ORDER BY 1, 2"),
            [
                { d: "C1", c: "01", cursos: "CC", n: 4 },
                { d: "C1", c: "02", cursos: "CC", n: 4 },
                { d: "C1", c: "03", cursos: "CC", n: 16 },
                { d: "C1", c: "04", cursos: "CC", n: null },
                { d: "IART001", c: "01", cursos: "IA", n: 4 },
            ],
        );
    });
});
