/**
 * Serve ao navegador o código de domínio compartilhado (src/shared/) como módulos ES:
 *   GET /shared/horario-sigaa.js · /shared/validador.js · /shared/tipos.js
 *
 * Assim o front valida um movimento com exatamente o mesmo parser SIGAA e o mesmo validador
 * (RN-01 a RN-04, choque de sala, escopo do IC) que o servidor usa na confirmação.
 *
 * O TypeScript é convertido com `stripTypeScriptTypes` do Node, que só apaga as anotações de tipo
 * e preserva linhas e colunas (os erros no navegador apontam para a mesma linha do .ts).
 * Por isso src/shared/ só pode usar sintaxe TypeScript apagável (sem enum/namespace).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as nodeModule from "node:module";
import { Router, type Request, type Response } from "express";
import { ErroNaoEncontrado } from "../../erros.ts";

const PASTA_SHARED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../shared");
export const MODULOS_COMPARTILHADOS: readonly string[] = Object.freeze(["grade", "horario-sigaa", "tipos", "validador"]);

type Stripper = (codigo: string, opcoes?: { mode?: "strip" | "transform" }) => string;

let stripper: Stripper | undefined;
function strip(codigo: string): string {
    if (!stripper) {
        const fn = (nodeModule as unknown as { stripTypeScriptTypes?: Stripper }).stripTypeScriptTypes;
        if (!fn) throw new Error("Este Node não tem module.stripTypeScriptTypes (requer Node 22.13+)");
        // A API é marcada como experimental; o aviso não ajuda quem usa o servidor
        const emitirOriginal = process.emitWarning;
        process.emitWarning = ((aviso: string | Error, ...resto: unknown[]) => {
            const texto = typeof aviso === "string" ? aviso : aviso.message;
            if (texto.includes("stripTypeScriptTypes")) return;
            (emitirOriginal as (...a: unknown[]) => void).call(process, aviso, ...resto);
        }) as typeof process.emitWarning;
        try {
            fn("const x: number = 1;"); // dispara (e silencia) o aviso uma única vez
        } finally {
            process.emitWarning = emitirOriginal;
        }
        stripper = fn;
    }
    return stripper(codigo, { mode: "strip" });
}

/** Converte um módulo de src/shared para JavaScript do navegador (imports ./x.ts -> ./x.js). */
export async function compilarModuloCompartilhado(nome: string): Promise<string> {
    if (!MODULOS_COMPARTILHADOS.includes(nome)) throw new ErroNaoEncontrado(`Módulo compartilhado '${nome}' não existe`);
    const fonte = await readFile(path.join(PASTA_SHARED, `${nome}.ts`), "utf8");
    return strip(fonte).replace(/(from\s+["']\.\/[\w-]+)\.ts(["'])/g, "$1.js$2");
}

const cache = new Map<string, string>();

export const sharedRouter = Router();

sharedRouter.get("/:arquivo", async (req: Request, res: Response) => {
    const arquivo = String(req.params.arquivo);
    const m = /^([\w-]+)\.js$/.exec(arquivo);
    if (!m) throw new ErroNaoEncontrado(`Módulo compartilhado '${arquivo}' não existe`);
    const nome = m[1];
    // Em desenvolvimento (npm run dev / local) o arquivo pode mudar: cache só em produção
    let js = process.env.NODE_ENV === "production" ? cache.get(nome) : undefined;
    if (!js) {
        js = await compilarModuloCompartilhado(nome);
        cache.set(nome, js);
    }
    res.type("text/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.send(js);
});
