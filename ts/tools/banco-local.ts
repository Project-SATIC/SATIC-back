/**
 * Banco PostgreSQL local sem Docker nem instalação, para desenvolvimento e integração com o front.
 *
 * Sobe um PostgreSQL real (PGlite, PostgreSQL 18 compilado para WebAssembly) com os dados em
 * disco (`ts/.pglite/`, fora do git), exposto numa porta TCP local para o driver `pg`.
 * Na partida aplica as migrations pendentes e, se o banco estiver vazio, roda o seed 2026.2.
 *
 *   npm run local          banco + API Express em http://localhost:3001 (um único terminal)
 *   npm run local:amostra  idem, só com 17 turmas reais para testes manuais (pasta ts/.pglite-amostra)
 *   npm run db:local       só o banco (para usar com `npm start` em outro terminal, com PGPOOL_MAX=1)
 * Banco recém-criado: aplica migrations, roda o seed e já gera a grade inicial com o motor.
 *
 * Opções: --porta=N (porta do banco), --dados=.pglite (pasta), --resetar (apaga e recria tudo).
 * Com `npm run local` o banco usa uma porta livre qualquer (só a API do mesmo processo o acessa),
 * para não brigar com um PostgreSQL instalado na 5432. Com `npm run db:local` o padrão é 5432.
 *
 * Só uma instância por pasta de dados: dois PGlite abrindo a mesma pasta podem corromper o banco.
 * A trava fica em `<pasta>.lock` (ex.: ts/.pglite.lock) com o PID de quem está rodando.
 *
 * Limitações do PGlite (só desenvolvimento, não produção): uma única sessão, por isso o pool
 * da API fica com 1 conexão; e o adaptador TCP fecha a conexão após um erro de SQL, que o pool
 * reabre sozinho.
 */
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { rm } from "node:fs/promises";
import { connect, createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const RAIZ_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function opcao(nome: string): string | undefined {
    const arg = process.argv.find((a) => a.startsWith(`--${nome}=`));
    return arg ? arg.slice(nome.length + 3) : undefined;
}

const comApi = process.argv.includes("--com-api");
const resetar = process.argv.includes("--resetar");
// Amostra de 17 turmas reais para testes manuais, em pasta própria (o banco completo não é tocado)
const amostra = process.argv.includes("--amostra");
const pastaDados = path.resolve(RAIZ_TS, opcao("dados") ?? (amostra ? ".pglite-amostra" : ".pglite"));
const arquivoTrava = `${pastaDados}.lock`;
const portaApi = Number(process.env.PORT || 3001);
// Porta do banco: a pedida; senão 5432 só no modo "só banco" (o npm start de outro terminal precisa dela)
const portaPedida = opcao("porta") ?? (comApi ? undefined : process.env.PGPORT || "5432");

function sair(mensagem: string): never {
    console.error(`[SATIC-LOCAL] ${mensagem}`);
    process.exit(1);
}

/** O processo ainda existe? (sinal 0 só testa; funciona no Windows e no Linux) */
function processoVivo(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === "EPERM";
    }
}

/**
 * Alguém atende nessa porta? Tentar conectar é o teste confiável: no Windows, abrir a mesma porta
 * em "::" e em "127.0.0.1" ao mesmo tempo nem sempre falha, então "consegui abrir" não prova nada.
 */
function portaOcupada(porta: number): Promise<boolean> {
    return new Promise((resolve) => {
        const sock = connect({ port: porta, host: "localhost" });
        const fim = (ocupada: boolean) => { sock.destroy(); resolve(ocupada); };
        sock.setTimeout(1500, () => fim(false));
        sock.once("connect", () => fim(true));
        sock.once("error", () => fim(false));
    });
}

/** Reserva uma porta livre em 127.0.0.1 (porta 0 = o sistema escolhe) e devolve qual foi. */
function testarPorta(porta: number, host = "127.0.0.1"): Promise<number | null> {
    return new Promise((resolve) => {
        const srv = createServer();
        srv.once("error", () => resolve(null));
        srv.listen(porta, host, () => {
            const real = (srv.address() as { port: number }).port;
            srv.close(() => resolve(real));
        });
    });
}

async function apiRespondendo(porta = portaApi): Promise<boolean> {
    try {
        const res = await fetch(`http://localhost:${porta}/api/health`, { signal: AbortSignal.timeout(2000) });
        return res.status === 200 || res.status === 503;
    } catch {
        return false;
    }
}

/**
 * Garante uma única instância por pasta de dados. Trava de outro processo que já morreu
 * (ex.: terminal fechado à força) é descartada.
 */
async function pegarTrava(): Promise<void> {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
        try {
            const fd = openSync(arquivoTrava, "wx");
            writeSync(fd, JSON.stringify({ pid: process.pid, inicio: new Date().toISOString(), api: comApi ? portaApi : null }));
            closeSync(fd);
            process.on("exit", () => {
                try {
                    if (JSON.parse(readFileSync(arquivoTrava, "utf8")).pid === process.pid) unlinkSync(arquivoTrava);
                } catch { /* já removida */ }
            });
            return;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        }
        let dono: { pid?: number; inicio?: string; api?: number | null } = {};
        try { dono = JSON.parse(readFileSync(arquivoTrava, "utf8")); } catch { /* trava corrompida: trata como velha */ }
        if (dono.pid && dono.pid !== process.pid && processoVivo(dono.pid)) {
            const api = dono.api ? await apiRespondendo(dono.api) : false;
            sair([
                `O SATIC local já está rodando (processo ${dono.pid}, desde ${dono.inicio ?? "?"}).`,
                api ? `A API dele responde em http://localhost:${dono.api}: você pode usá-la como está.` : "",
                `Para reiniciar, encerre o anterior (Ctrl+C no terminal dele, ou no PowerShell: Stop-Process -Id ${dono.pid}) e rode de novo.`,
                "Dois bancos abrindo a mesma pasta de dados ao mesmo tempo poderiam corromper os dados, por isso este não iniciou.",
            ].filter(Boolean).join("\n             "));
        }
        console.log(`[SATIC-LOCAL] Trava antiga de um processo que já terminou (${dono.pid ?? "?"}): removendo.`);
        try { unlinkSync(arquivoTrava); } catch { /* outro processo removeu antes */ }
    }
    sair(`Não foi possível criar a trava ${arquivoTrava}.`);
}

async function main(): Promise<void> {
    // 1. Trava e portas ANTES de abrir a pasta de dados
    await pegarTrava();

    if (comApi && await portaOcupada(portaApi)) {
        // Instância antiga sem trava (ex.: iniciada antes desta versão) ou outro programa na porta
        sair(await apiRespondendo()
            ? [`Já existe uma API do SATIC respondendo em http://localhost:${portaApi}: provavelmente um "npm run local" anterior que ficou aberto.`,
                "Use-a como está, ou encerre-a e rode de novo. No PowerShell:",
                `Stop-Process -Id (Get-NetTCPConnection -LocalPort ${portaApi} -State Listen).OwningProcess`].join("\n             ")
            : `A porta ${portaApi} da API está em uso por outro programa. Use outra: $env:PORT=3002; npm run local`);
    }

    let porta: number;
    if (portaPedida !== undefined) {
        porta = Number(portaPedida);
        if (!Number.isInteger(porta) || porta <= 0 || porta > 65535) sair(`Porta inválida: ${portaPedida}`);
        if (await portaOcupada(porta)) {
            sair(`A porta ${porta} do banco já está em uso (um PostgreSQL instalado, ou outro "npm run db:local"?). Use outra: npm run db:local -- --porta=5433`);
        }
    } else {
        const livre = await testarPorta(0);
        if (livre === null) sair("Não foi possível reservar uma porta livre para o banco.");
        porta = livre;
    }

    // O pool da API e dos scripts aponta para este banco (sobrepõe o .env)
    delete process.env.DATABASE_URL;
    Object.assign(process.env, {
        PGHOST: "127.0.0.1",
        PGPORT: String(porta),
        PGUSER: "postgres",
        PGPASSWORD: "postgres",
        PGDATABASE: "postgres",
        PGPOOL_MAX: "1",
    });

    if (resetar) {
        console.log(`[SATIC-LOCAL] --resetar: apagando ${pastaDados}`);
        await rm(pastaDados, { recursive: true, force: true });
    }

    // 2. Banco
    console.log(`[SATIC-LOCAL] Abrindo PostgreSQL (PGlite) em ${pastaDados}...`);
    const db = await PGlite.create({ dataDir: pastaDados });
    const servidorBanco = new PGLiteSocketServer({ db, port: porta, host: "127.0.0.1" });
    try {
        await servidorBanco.start();
    } catch (err) {
        await db.close();
        sair(`Falha ao abrir a porta ${porta} do banco: ${(err as Error).message}`);
    }
    console.log(`[SATIC-LOCAL] PostgreSQL ouvindo em 127.0.0.1:${porta} (usuário postgres, banco postgres)`);

    // Importados só agora, com o ambiente já apontando para o banco local
    const { closePool, query } = await import("../src/db/connection.ts");
    const { executarMigrations } = await import("../src/db/migrator.ts");
    const { executarSeed } = await import("../src/seed/db-seeder.ts");

    const resultados = await executarMigrations();
    const aplicadas = resultados.filter((r) => r.status === "aplicada").length;
    console.log(`[SATIC-LOCAL] Migrations: ${aplicadas} aplicada(s), ${resultados.length - aplicadas} já existente(s).`);

    const { rows } = await query<{ n: number }>("SELECT COUNT(*)::int AS n FROM turma;");
    if (rows[0].n === 0) {
        console.log(`[SATIC-LOCAL] Banco vazio: rodando o seed 2026.2${amostra ? " (AMOSTRA para testes manuais)" : ""}...`);
        const r = await executarSeed({ amostra });
        console.log(`[SATIC-LOCAL] Seed: ${r.turmas} turmas, ${r.salas} salas, ${r.reservasExternas} reservas EXTERNA_FIXA.`);
        // Grade inicial pelo motor de salas, para a interface já abrir preenchida
        const { AlocadorService } = await import("../src/motor/alocador.service.ts");
        const g = await new AlocadorService().gerarAlocacao({ semestre: "2026.2" });
        console.log(`[SATIC-LOCAL] Grade inicial gerada: ${g.resumo.alocadas} de ${g.resumo.totalTurmas} turmas alocadas${g.resumo.pendentes ? `, ${g.resumo.pendentes} pendente(s)` : ""}.`);
    } else {
        console.log(`[SATIC-LOCAL] Banco já povoado (${rows[0].n} turmas${amostra ? ", amostra" : ""}). Use --resetar para recriar do zero.`);
    }

    let encerrando = false;
    let servidorApi: import("node:http").Server | undefined;
    async function encerrar(sinal: string): Promise<void> {
        if (encerrando) return;
        encerrando = true;
        console.log(`[SATIC-LOCAL] ${sinal}: encerrando e gravando os dados em disco...`);
        if (servidorApi) await new Promise<void>((resolve) => servidorApi!.close(() => resolve()));
        await closePool().catch(() => undefined);
        await servidorBanco.stop().catch(() => undefined);
        await db.close();
        process.exit(sinal === "erro" ? 1 : 0);
    }
    process.on("SIGINT", () => void encerrar("SIGINT"));
    process.on("SIGTERM", () => void encerrar("SIGTERM"));

    // 3. API
    if (comApi) {
        await import("dotenv/config");
        const { criarApp } = await import("../src/api/app.ts");
        servidorApi = criarApp().listen(portaApi, () => {
            console.log(`[SATIC-LOCAL] API Express em http://localhost:${portaApi} (health: /api/health)`);
            console.log("[SATIC-LOCAL] Ctrl+C para encerrar.");
        });
        servidorApi.on("error", (err: NodeJS.ErrnoException) => {
            console.error(err.code === "EADDRINUSE"
                ? `[SATIC-LOCAL] A porta ${portaApi} da API já está em uso (defina PORT).`
                : `[SATIC-LOCAL] Falha ao iniciar a API: ${err.message}`);
            void encerrar("erro");
        });
    } else {
        console.log(`[SATIC-LOCAL] Só o banco está no ar. Em outro terminal: $env:PGPORT=${porta}; $env:PGPOOL_MAX=1; npm start`);
        console.log("[SATIC-LOCAL] Ctrl+C para encerrar.");
    }
}

main().catch((err) => {
    console.error("[SATIC-LOCAL] Erro fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
});
