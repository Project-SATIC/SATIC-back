package dao;

import model.Disciplina;
import model.Professor;
import model.Sala;
import model.Turma;

import java.sql.SQLException;
import java.util.*;

/**
 * Seeder oficial da base real do IC/UFAL para o período 2026.2 (Ciência da Computação + Engenharia da Computação).
 * Realiza normalização de espaços físicos (IC, BL12, IM e Externos) e deduplicação automática de turmas
 * ofertadas em conjunto para ambos os cursos via chave natural (semestre + disciplina + codigoTurma).
 */
public class DatabaseSeeder {

    private static final String SEMESTRE = "2026.2";

    /**
     * Gabarito real extraído do SIGAA 2026.2 (chave: "CODIGO_DISC-TURMA", valor: nome normalizado da sala).
     * Utilizado posteriormente para benchmarking e comparação de eficácia do algoritmo.
     */
    private static final Map<String, String> GABARITO_SIGAA = new LinkedHashMap<>();

    private record OfertaRegistro(
            String curso,
            String codigoDisciplina,
            String nomeDisciplina,
            int cargaHoraria,
            boolean exigeLab,
            String codigoTurma,
            String horarioSigaa,
            int matriculados,
            int vagas,
            String localNormalizado,
            boolean requerAlocacaoIc,
            List<DocenteCarga> docentes
    ) {}

    private record DocenteCarga(String nome, int cargaHoraria) {}

    private static DocenteCarga doc(String nome, int ch) {
        return new DocenteCarga(nome, ch);
    }

    public static Map<String, String> getGabaritoSigaa() {
        if (GABARITO_SIGAA.isEmpty()) {
            for (OfertaRegistro reg : construirOfertasBrutas()) {
                if (reg.localNormalizado() != null) {
                    GABARITO_SIGAA.put(reg.codigoDisciplina() + "-" + reg.codigoTurma(), reg.localNormalizado());
                }
            }
        }
        return Collections.unmodifiableMap(GABARITO_SIGAA);
    }

    /**
     * Popula o banco SQLite caso esteja vazio (ou força recarga completa se resetar = true).
     */
    public static void seed(boolean resetar) {
        if (resetar) {
            DatabaseInitializer.recreateSchema();
        } else {
            DatabaseInitializer.initialize();
        }

        SalaDAO salaDAO = new SalaDAO();
        ProfessorDAO profDAO = new ProfessorDAO();
        DisciplinaDAO discDAO = new DisciplinaDAO();
        TurmaDAO turmaDAO = new TurmaDAO();

        try {
            if (!resetar && !turmaDAO.listarTodas().isEmpty()) {
                System.out.println("[SATIC-SEED] Banco já populado. Nenhuma carga adicional executada.");
                return;
            }

            // 1. Carga das Salas Reais (Bloco IC, BL12, IM cedidas cap. 30, e Espaços Externos)
            seedSalas(salaDAO);

            // 2. Construção da lista bruta (CC 52 + EC 63) e deduplicação de turmas conjuntas
            List<OfertaRegistro> ofertasBrutas = construirOfertasBrutas();
            Map<String, Turma> turmasDeduplicadas = new LinkedHashMap<>();
            Map<String, Disciplina> disciplinasUnicas = new LinkedHashMap<>();
            Map<String, Professor> professoresUnicos = new LinkedHashMap<>();

            int duplicadasConjuntas = 0;

            for (OfertaRegistro reg : ofertasBrutas) {
                String chaveTurma = SEMESTRE + "|" + reg.codigoDisciplina() + "|" + reg.codigoTurma();

                // Registra disciplina (PK por código garante que "Matemática Discreta" COMP362 != ECOM003)
                Disciplina disc = disciplinasUnicas.computeIfAbsent(reg.codigoDisciplina(), k ->
                        new Disciplina(reg.codigoDisciplina(), reg.nomeDisciplina(), reg.cargaHoraria(), reg.exigeLab())
                );

                // Registra gabarito SIGAA
                if (reg.localNormalizado() != null) {
                    GABARITO_SIGAA.put(reg.codigoDisciplina() + "-" + reg.codigoTurma(), reg.localNormalizado());
                }

                Turma existente = turmasDeduplicadas.get(chaveTurma);
                if (existente != null) {
                    // Mesma turma física compartilhada entre CC e EC (ex: CPT0035, ECOM011, ECOM041)
                    if (!existente.getCursosOfertados().contains(reg.curso())) {
                        existente.setCursosOfertados(existente.getCursosOfertados() + ", " + reg.curso());
                    }
                    duplicadasConjuntas++;
                } else {
                    Turma nova = new Turma(
                            disc,
                            reg.codigoTurma(),
                            SEMESTRE,
                            reg.curso(),
                            reg.horarioSigaa(),
                            reg.vagas(),
                            reg.matriculados(),
                            reg.requerAlocacaoIc()
                    );

                    for (DocenteCarga dc : reg.docentes()) {
                        Professor prof = professoresUnicos.computeIfAbsent(dc.nome(), nome ->
                                new Professor(gerarSiapeDeterministico(nome), nome)
                        );
                        nova.adicionarProfessor(prof, dc.cargaHoraria());
                    }

                    turmasDeduplicadas.put(chaveTurma, nova);
                }
            }

            // 3. Persistência ordenada no SQLite
            for (Professor p : professoresUnicos.values()) {
                profDAO.inserir(p);
            }
            for (Disciplina d : disciplinasUnicas.values()) {
                discDAO.inserir(d);
            }
            for (Turma t : turmasDeduplicadas.values()) {
                turmaDAO.inserir(t);
            }

            System.out.printf(
                    "[SATIC-SEED] Carga concluída com sucesso! Salas: %d | Professores: %d | Disciplinas: %d | Turmas únicas: %d (Conjuntas CC+EC deduplicadas: %d)%n",
                    salaDAO.listarTodas().size(),
                    professoresUnicos.size(),
                    disciplinasUnicas.size(),
                    turmasDeduplicadas.size(),
                    duplicadasConjuntas
            );

        } catch (SQLException e) {
            throw new RuntimeException("Erro ao popular dados reais de 2026.2 no SQLite: " + e.getMessage(), e);
        }
    }

    private static void seedSalas(SalaDAO salaDAO) throws SQLException {
        List<Sala> salas = List.of(
                // Bloco IC - Salas Teóricas e Auditórios
                new Sala("Sala 02 IC", 60, "Sala", "IC", true),
                new Sala("Sala 03 IC", 55, "Sala", "IC", true),
                new Sala("Sala 04 IC", 45, "Sala", "IC", true),
                new Sala("Auditório IC", 76, "Auditório", "IC", true),
                new Sala("Auditório CEPETEC", 70, "Auditório", "IC", true),

                // Bloco IC - Laboratórios
                new Sala("Laboratório 01 - IC", 65, "Laboratório", "IC", true),
                new Sala("Laboratório 02 - IC", 50, "Laboratório", "IC", true),
                new Sala("Laboratório 03 - IC", 30, "Laboratório", "IC", true),
                new Sala("Laboratório 04 - IC", 30, "Laboratório", "IC", true),
                new Sala("Laboratório de Robótica-IC", 30, "Laboratório", "IC", true),
                new Sala("LCCV", 60, "Laboratório", "IC", true),

                // Bloco 12 (salas alocadas pelo IC)
                new Sala("Sala 206 BL12", 40, "Sala", "BL12", true),
                new Sala("Sala 207 BL12", 54, "Sala", "BL12", true),

                // Instituto de Matemática - Salas cedidas ao IC (capacidade padrão: 30 alunos)
                new Sala("Sala 01 - IM", 30, "Sala", "IM", true),
                new Sala("Sala 02 - IM", 30, "Sala", "IM", true),

                // Espaços Externos de Outros Institutos (não gerenciados pelo pool de alocação do IC)
                new Sala("CTEC", 50, "Sala", "CTEC", false),
                new Sala("Sala 7A - CTEC", 60, "Sala", "CTEC", false),
                new Sala("Sala 03 - IF", 55, "Sala", "IF", false),
                new Sala("Laboratório de Ensino 3 - IF", 24, "Laboratório", "IF", false)
        );

        for (Sala s : salas) {
            salaDAO.inserir(s);
        }
    }

    private static String gerarSiapeDeterministico(String nome) {
        return switch (nome) {
            case "RANILSON OSCAR ARAUJO PAIVA" -> "2024389";
            case "BALDOINO FONSECA DOS SANTOS NETO" -> "1849201";
            case "WILLY CARVALHO TIENGO" -> "1930412";
            case "EVANDRO DE BARROS COSTA" -> "1520394";
            case "MARCIO DE MEDEIROS RIBEIRO" -> "1659302";
            case "GLAUBER RODRIGUES LEITE" -> "2291043";
            default -> String.format("IC-%06d", Math.abs(nome.hashCode()) % 999999);
        };
    }

    private static List<OfertaRegistro> construirOfertasBrutas() {
        List<OfertaRegistro> lista = new ArrayList<>();

        // =========================================================================
        // 1. OFERTA SIGAA 2026.2 — CIÊNCIA DA COMPUTAÇÃO (52 TURMAS)
        // =========================================================================
        lista.add(new OfertaRegistro("CC", "COMP377", "ACE 1: PROJETO I", 75, false, "01", "2M34", 28, 28, "Sala 02 IC", true, List.of(doc("MARIA CRISTINA TENORIO CAVALCANTE ESCARPINI", 75))));
        lista.add(new OfertaRegistro("CC", "COMP383", "ACE 2: CONTINUIDADE DO PROJETO I", 75, false, "01", "2T12", 30, 30, "Sala 206 BL12", true, List.of(doc("MARIA CRISTINA TENORIO CAVALCANTE ESCARPINI", 75))));
        lista.add(new OfertaRegistro("CC", "COMP384", "ACE 3: PROJETO 2", 75, false, "01", "2T34", 24, 25, "Sala 206 BL12", true, List.of(doc("MARIA CRISTINA TENORIO CAVALCANTE ESCARPINI", 75))));
        lista.add(new OfertaRegistro("CC", "COMP384", "ACE 3: PROJETO 2", 75, false, "02", "7M45", 27, 30, "Auditório IC", true, List.of(doc("LEONARDO VIANA PEREIRA", 75))));
        lista.add(new OfertaRegistro("CC", "COMP388", "ACE 4: CONTINUAÇÃO DO PROJETO 2", 65, false, "02", "3T12", 25, 25, null, true, List.of(doc("ROBERTA VILHENA VIEIRA LOPES", 65)))); // IC - A definir
        lista.add(new OfertaRegistro("CC", "COMP385", "ACE 5: EVENTO", 75, false, "01", "3T56", 40, 40, "Auditório CEPETEC", true, List.of(doc("MARIA CRISTINA TENORIO CAVALCANTE ESCARPINI", 75))));
        lista.add(new OfertaRegistro("CC", "ECOM011", "ÁLGEBRA LINEAR", 60, false, "01", "24T34", 65, 70, "Auditório IC", true, List.of(doc("ARTURO JIMENEZ LOAIZA", 60))));
        lista.add(new OfertaRegistro("CC", "COMP390", "APRENDIZAGEM DE MÁQUINA", 72, false, "01", "35T56", 39, 42, "Auditório IC", true, List.of(doc("AYDANO PAMPONET MACHADO", 72))));
        lista.add(new OfertaRegistro("CC", "ECOM041", "BANCO DE DADOS", 60, false, "01", "35M56", 61, 62, "Auditório IC", true, List.of(doc("FABIO JOSE COUTINHO DA SILVA", 60))));
        lista.add(new OfertaRegistro("CC", "CPT0040", "BLOCKCHAIN E WEB 3.0", 72, true, "01", "35M34", 24, 25, "LCCV", true, List.of(doc("LEANDRO MELO DE SALES", 72))));
        lista.add(new OfertaRegistro("CC", "CPT0035", "CÁLCULO 1", 72, false, "01", "35M34", 75, 75, "Auditório IC", true, List.of(doc("XU YANG", 72))));
        lista.add(new OfertaRegistro("CC", "CPT0036", "CÁLCULO 2", 72, false, "01", "35T12", 60, 60, "Auditório IC", true, List.of(doc("GLEYDSON SANTOS DA SILVA", 72))));
        lista.add(new OfertaRegistro("CC", "ECOM017", "CÁLCULO 3", 60, false, "01", "36M12", 48, 50, "Sala 02 IC", true, List.of(doc("GLEYDSON SANTOS DA SILVA", 60))));
        lista.add(new OfertaRegistro("CC", "COMP401", "CIÊNCIA DE DADOS", 72, true, "01", "24M34", 28, 40, "Laboratório 01 - IC", true, List.of(doc("BRUNO ALMEIDA PIMENTEL", 72))));
        lista.add(new OfertaRegistro("CC", "COMP379", "COMPILADORES", 72, false, "01", "24M56", 38, 40, "Sala 04 IC", true, List.of(doc("ARTURO HERNANDEZ DOMINGUEZ", 72))));
        lista.add(new OfertaRegistro("CC", "COMP397", "COMPUTAÇÃO EVOLUCIONÁRIA", 72, true, "02", "23T34", 10, 30, "Laboratório 03 - IC", true, List.of(doc("ROBERTA VILHENA VIEIRA LOPES", 72))));
        lista.add(new OfertaRegistro("CC", "COMP381", "COMPUTAÇÃO GRÁFICA", 72, false, "02", "36M56", 40, 41, "Sala 03 IC", true, List.of(doc("MARCELO COSTA OLIVEIRA", 72))));
        lista.add(new OfertaRegistro("CC", "ECOM039", "COMPUTAÇÃO GRÁFICA E PROCESSAMENTO DE IMAGENS", 60, false, "01", "35T12", 34, 40, "Sala 04 IC", true, List.of(doc("TIAGO FIGUEIREDO VIEIRA", 60))));
        lista.add(new OfertaRegistro("CC", "COMP361", "COMPUTAÇÃO, SOCIEDADE E ÉTICA", 72, false, "01", "56M12", 44, 46, "Sala 03 IC", true, List.of(doc("ALAN PEDRO DA SILVA", 72))));
        lista.add(new OfertaRegistro("CC", "COMP389", "CONCEITOS DE LINGUAGEM DE PROGRAMAÇÃO", 72, false, "01", "35T34", 34, 40, "Sala 02 IC", true, List.of(doc("RAFAEL DE AMORIM SILVA", 72))));
        lista.add(new OfertaRegistro("CC", "COMP364", "ESTRUTURA DE DADOS", 72, false, "01", "23T56", 41, 45, "Sala 03 IC", true, List.of(doc("ROBERTA VILHENA VIEIRA LOPES", 72))));
        lista.add(new OfertaRegistro("CC", "ECOM005", "GEOMETRIA ANALÍTICA", 60, false, "01", "24M56", 75, 76, "Auditório IC", true, List.of(doc("ARTURO JIMENEZ LOAIZA", 60))));
        lista.add(new OfertaRegistro("CC", "COMP399", "GERÊNCIA DE PROJETO", 72, false, "01", "35T56", 39, 40, "Sala 02 IC", true, List.of(doc("RAFAEL DE AMORIM SILVA", 72))));
        lista.add(new OfertaRegistro("CC", "ECOM031", "INTELIGÊNCIA ARTIFICIAL", 60, false, "01", "35M34", 60, 60, "Sala 02 IC", true, List.of(doc("EVANDRO DE BARROS COSTA", 60))));
        lista.add(new OfertaRegistro("CC", "COMP395", "INTERAÇÃO HOMEM-MÁQUINA", 72, false, "01", "24T34", 36, 40, "Sala 02 IC", true, List.of(doc("FABIO PARAGUACU DUARTE DA COSTA", 72))));
        lista.add(new OfertaRegistro("CC", "COMP441", "LABORATÓRIO DE INTELIGÊNCIA ARTIFICIAL EM ROBÓTICA", 72, true, "01", "2T1234", 22, 30, "Laboratório de Robótica-IC", true, List.of(doc("LEONARDO VIANA PEREIRA", 72))));
        lista.add(new OfertaRegistro("CC", "ECOM007", "LÓGICA APLICADA À COMPUTAÇÃO", 60, false, "01", "35T34", 30, 55, "Auditório IC", true, List.of(doc("EVANDRO DE BARROS COSTA", 60))));
        lista.add(new OfertaRegistro("CC", "COMP360", "LÓGICA PARA COMPUTAÇÃO", 72, false, "01", "24M34", 42, 45, "Sala 02 IC", true, List.of(doc("FABIO PARAGUACU DUARTE DA COSTA", 72))));
        lista.add(new OfertaRegistro("CC", "COMP362", "MATEMÁTICA DISCRETA", 72, false, "01", "24T12", 54, 55, "Sala 03 IC", true, List.of(doc("LUCAS BENEVIDES VIANA DE AMORIM", 72))));
        lista.add(new OfertaRegistro("CC", "ECOM003", "MATEMÁTICA DISCRETA", 60, false, "01", "24M12", 49, 75, "Auditório IC", true, List.of(doc("BRUNO ALMEIDA PIMENTEL", 60))));
        lista.add(new OfertaRegistro("CC", "IART001", "MATEMÁTICA DISCRETA PARA COMPUTAÇÃO", 72, false, "01", "4N1234", 54, 55, "Auditório IC", true, List.of(doc("EVANDRO DE BARROS COSTA", 36), doc("FABIANE DA SILVA QUEIROZ", 36))));
        lista.add(new OfertaRegistro("CC", "COMP386", "METODOLOGIA DE PESQUISA E TRABALHO INDIVIDUAL", 72, false, "01", "36M34", 36, 36, "Sala 03 IC", true, List.of(doc("MARCELO COSTA OLIVEIRA", 72))));
        lista.add(new OfertaRegistro("CC", "ECOM036", "MÉTODOS NUMÉRICOS", 60, false, "01", "2T56 6T12", 36, 42, "Sala 02 IC", true, List.of(doc("THALES MIRANDA DE ALMEIDA VIEIRA", 60))));
        lista.add(new OfertaRegistro("CC", "COMP387", "NOÇÕES DE DIREITO", 72, false, "01", "6T1234", 56, 70, "Auditório CEPETEC", true, List.of(doc("CID CAVALCANTI DE ALBUQUERQUE", 72))));
        lista.add(new OfertaRegistro("CC", "COMP366", "ORGANIZAÇÃO E ARQUITETURA DE COMPUTADORES", 72, true, "01", "24T34", 39, 41, "Laboratório 01 - IC", true, List.of(doc("LUCAS BENEVIDES VIANA DE AMORIM", 72))));
        lista.add(new OfertaRegistro("CC", "COMP370", "PROBABILIDADE E ESTATÍSTICA", 72, false, "01", "35T12", 30, 31, "Sala 02 IC", true, List.of(doc("RANILSON OSCAR ARAUJO PAIVA", 72))));
        lista.add(new OfertaRegistro("CC", "ECOM179", "PROCESSAMENTO DE LINGUAGEM NATURAL", 60, false, "01", "26T34", 41, 41, "Sala 04 IC", true, List.of(doc("THALES MIRANDA DE ALMEIDA VIEIRA", 60))));
        lista.add(new OfertaRegistro("CC", "COMP359", "PROGRAMAÇÃO 1", 72, true, "01", "6M3456", 60, 65, "Laboratório 01 - IC", true, List.of(doc("RODRIGO DE BARROS PAES", 72))));
        lista.add(new OfertaRegistro("CC", "IART002", "PROGRAMAÇÃO 1", 72, true, "01", "2N1234", 52, 55, "Laboratório 01 - IC", true, List.of(doc("FABIANE DA SILVA QUEIROZ", 72))));
        lista.add(new OfertaRegistro("CC", "COMP372", "PROGRAMAÇÃO 2", 72, true, "01", "35T12", 32, 32, "Laboratório 02 - IC", true, List.of(doc("MARIO HOZANO LUCAS DE SOUZA", 72))));
        lista.add(new OfertaRegistro("CC", "COMP373", "PROGRAMAÇÃO 3", 72, true, "02", "35T34", 31, 31, "Laboratório 02 - IC", true, List.of(doc("RANILSON OSCAR ARAUJO PAIVA", 72))));
        lista.add(new OfertaRegistro("CC", "ECOM027", "PROJETO E ANÁLISE DE ALGORITMOS", 60, true, "01", "25M56", 49, 55, "Laboratório 01 - IC", true, List.of(doc("RIAN GABRIEL SANTOS PINHEIRO", 60))));
        lista.add(new OfertaRegistro("CC", "ECOM027", "PROJETO E ANÁLISE DE ALGORITMOS", 60, true, "03", "25T56", 27, 55, "Laboratório 01 - IC", true, List.of(doc("RIAN GABRIEL SANTOS PINHEIRO", 60))));
        lista.add(new OfertaRegistro("CC", "COMP382", "PROJETO E DESENVOLVIMENTO DE SISTEMAS", 72, false, "01", "2345M3456", 41, 42, "Auditório CEPETEC", true, List.of(
                doc("ALAN PEDRO DA SILVA", 72),
                doc("WILLY CARVALHO TIENGO", 72),
                doc("RODRIGO DE BARROS PAES", 72),
                doc("IG IBERT BITTENCOURT SANTANA PINTO", 72)
        )));
        lista.add(new OfertaRegistro("CC", "ECOM029", "REDES DE COMPUTADORES", 60, true, "01", "34M56", 54, 55, "Laboratório 01 - IC", true, List.of(doc("ALMIR PEREIRA GUIMARAES", 60))));
        lista.add(new OfertaRegistro("CC", "COMP393", "REDES NEURAIS E APRENDIZADO PROFUNDO", 72, false, "02", "35T34", 29, 40, "Sala 04 IC", true, List.of(doc("TIAGO FIGUEIREDO VIEIRA", 72))));
        lista.add(new OfertaRegistro("CC", "COMP403", "SEGURANÇA DE SISTEMAS COMPUTACIONAIS", 72, true, "01", "46M34", 9, 30, "Laboratório 04 - IC", true, List.of(doc("ALMIR PEREIRA GUIMARAES", 72))));
        lista.add(new OfertaRegistro("CC", "ECOM095", "SISTEMAS DE TEMPO REAL E APLICAÇÕES", 60, false, "01", "5T1234", 12, 40, "Sala 206 BL12", true, List.of(doc("BRUNO COSTA E SILVA NOGUEIRA", 60))));
        lista.add(new OfertaRegistro("CC", "COMP392", "SISTEMAS DISTRIBUÍDOS", 72, true, "02", "35M56", 44, 60, "LCCV", true, List.of(doc("LEANDRO MELO DE SALES", 72))));
        lista.add(new OfertaRegistro("CC", "ECOM032", "SISTEMAS OPERACIONAIS", 60, false, "01", "24M34", 50, 50, "Sala 207 BL12", true, List.of(doc("ANDRE LUIZ LINS DE AQUINO", 60))));
        lista.add(new OfertaRegistro("CC", "COMP376", "TEORIA DA COMPUTAÇÃO", 72, false, "01", "24T12", 30, 31, "Sala 02 IC", true, List.of(doc("FABIO PARAGUACU DUARTE DA COSTA", 72))));
        lista.add(new OfertaRegistro("CC", "COMP369", "TEORIA DOS GRAFOS", 72, false, "03", "4M34 5M12", 52, 54, "Sala 207 BL12", true, List.of(doc("XU YANG", 72))));

        // =========================================================================
        // 2. OFERTA SIGAA 2026.2 — ENGENHARIA DA COMPUTAÇÃO (63 TURMAS)
        // =========================================================================
        lista.add(new OfertaRegistro("EC", "ECOM011", "ÁLGEBRA LINEAR", 60, false, "01", "24T34", 65, 70, "Auditório IC", true, List.of(doc("ARTURO JIMENEZ LOAIZA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM061", "AUTOMAÇÃO INDUSTRIAL", 60, true, "01", "6T1234", 24, 30, "Laboratório 02 - IC", true, List.of(doc("JOAO RAPHAEL SOUZA MARTINS", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM041", "BANCO DE DADOS", 60, false, "01", "35M56", 61, 62, "Auditório IC", true, List.of(doc("FABIO JOSE COUTINHO DA SILVA", 60))));
        lista.add(new OfertaRegistro("EC", "CPT0035", "CÁLCULO 1", 72, false, "01", "35M34", 75, 75, "Auditório IC", true, List.of(doc("XU YANG", 72))));
        lista.add(new OfertaRegistro("EC", "CPT0036", "CÁLCULO 2", 72, false, "01", "35T12", 60, 60, "Auditório IC", true, List.of(doc("GLEYDSON SANTOS DA SILVA", 72))));
        lista.add(new OfertaRegistro("EC", "ECOM017", "CÁLCULO 3", 60, false, "01", "36M12", 48, 50, "Sala 02 IC", true, List.of(doc("GLEYDSON SANTOS DA SILVA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM023", "CÁLCULO 4", 60, false, "01", "56T56", 34, 35, "Sala 02 IC", true, List.of(doc("GLEYDSON SANTOS DA SILVA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM012", "CIRCUITOS DIGITAIS", 30, false, "01", "3T56", 34, 40, "Sala 04 IC", true, List.of(doc("ALMIR PEREIRA GUIMARAES", 30))));
        lista.add(new OfertaRegistro("EC", "ECOM028", "CIRCUITOS ELÉTRICOS", 60, false, "01", "24M12", 36, 41, "Sala 04 IC", true, List.of(doc("MAURICIO BELTRAO DE ROSSITER CORREA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM039", "COMPUTAÇÃO GRÁFICA E PROCESSAMENTO DE IMAGENS", 60, false, "01", "35T12", 34, 40, "Sala 04 IC", true, List.of(doc("TIAGO FIGUEIREDO VIEIRA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM048", "COMPUTADOR, SOCIEDADE E ÉTICA", 30, false, "01", "3T56", 29, 30, "Sala 03 IC", true, List.of(doc("JÚLIA GABRIELE LIMA DA ROSA", 30))));
        lista.add(new OfertaRegistro("EC", "ECOM013", "DESENHO", 60, true, "01", "6T1234", 31, 35, "Laboratório 01 - IC", true, List.of(doc("DILSON BATISTA FERREIRA", 60), doc("STELLA ROSANE DA SILVA OLIVEIRA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM035", "ELETRÔNICA", 60, false, "01", "56T56", 29, 30, "Sala 04 IC", true, List.of(doc("JOAO RAPHAEL SOUZA MARTINS", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM040", "EMPREENDEDORISMO", 60, false, "01", "35T34", 39, 41, "Sala 03 IC", true, List.of(doc("MARIO HOZANO LUCAS DE SOUZA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM021", "ENGENHARIA DE SOFTWARE", 60, true, "01", "23T56", 27, 30, "Laboratório 02 - IC", true, List.of(doc("ARTURO HERNANDEZ DOMINGUEZ", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM008", "ESTRUTURA DE DADOS", 60, false, "01", "24T56", 55, 61, "Auditório IC", true, List.of(doc("MARCIO DE MEDEIROS RIBEIRO", 60))));
        lista.add(new OfertaRegistro("EC", "ECIV026", "FENÔMENOS DE TRANSPORTE 1", 60, false, "01", "35T12", 50, 50, "CTEC", false, List.of(doc("CARLOS RUBERTO FRAGOSO JUNIOR", 60))));
        lista.add(new OfertaRegistro("EC", "IF0001", "FÍSICA 1 - MECÂNICA", 72, false, "05", "24T12", 37, 50, "Sala 207 BL12", false, List.of(doc("RAUL LIMA FERREIRA", 72))));
        lista.add(new OfertaRegistro("EC", "IF0002", "FÍSICA 2 - FLUIDOS, OSCILAÇÕES, ONDAS E TERMODINÂMICA", 72, false, "02", "24M12", 53, 60, "Sala 7A - CTEC", false, List.of(doc("ELTON MALTA NASCIMENTO", 36), doc("ANDERSON ANTUNES NOGUEIRA", 36))));
        lista.add(new OfertaRegistro("EC", "IF0003", "FÍSICA 3 - ELETRICIDADE E MAGNETISMO", 72, false, "03", "35T34", 23, 55, "Sala 03 - IF", false, List.of(doc("CARLOS JACINTO DA SILVA", 72))));
        lista.add(new OfertaRegistro("EC", "ECOM005", "GEOMETRIA ANALÍTICA", 60, false, "01", "24M56", 75, 76, "Auditório IC", true, List.of(doc("ARTURO JIMENEZ LOAIZA", 60))));
        lista.add(new OfertaRegistro("EC", "FALE0002", "INGLÊS INSTRUMENTAL - LEITURA DE TEXTOS ACADÊMICOS EM LÍNGUA INGLESA", 60, false, "03", "5T1234", 36, 40, "Auditório CEPETEC", false, List.of(doc("PAULO LEONCIO DA SILVA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM060", "INSTRUMENTAÇÃO ELETRÔNICA", 60, true, "01", "24M56", 26, 30, "Laboratório 02 - IC", true, List.of(doc("MAURICIO BELTRAO DE ROSSITER CORREA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM031", "INTELIGÊNCIA ARTIFICIAL", 60, false, "01", "35M34", 60, 60, "Sala 02 IC", true, List.of(doc("EVANDRO DE BARROS COSTA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM006", "INTRODUÇÃO À ENGENHARIA DE COMPUTAÇÃO", 60, false, "01", "24M34", 31, 35, "Sala 03 IC", true, List.of(doc("THIAGO DAMASCENO CORDEIRO", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM066", "LABORATÓRIO DE ELETRÔNICA", 30, true, "01", "6M56", 18, 20, "Laboratório 04 - IC", true, List.of(doc("JOAO RAPHAEL SOUZA MARTINS", 30))));
        lista.add(new OfertaRegistro("EC", "IF0006", "LABORATÓRIO DE FÍSICA 3 - ELETRICIDADE E MAGNETISMO", 28, true, "06", "6M12", 18, 20, "Laboratório de Ensino 3 - IF", false, List.of(doc("EDUARDO JORGE DA SILVA FONSECA", 28))));
        lista.add(new OfertaRegistro("EC", "IF0006", "LABORATÓRIO DE FÍSICA 3 - ELETRICIDADE E MAGNETISMO", 36, true, "08", "6T12", 24, 24, "Laboratório de Ensino 3 - IF", false, List.of(doc("YUSET GUERRA DAVILA", 36))));
        lista.add(new OfertaRegistro("EC", "COMP441", "LABORATÓRIO DE INTELIGÊNCIA ARTIFICIAL EM ROBÓTICA", 72, true, "01", "2T1234", 22, 30, "Laboratório de Robótica-IC", true, List.of(doc("LEONARDO VIANA PEREIRA", 72))));
        lista.add(new OfertaRegistro("EC", "ECOM014", "LINGUAGENS FORMAIS, AUTÔMATOS E COMPUTABILIDADE", 60, false, "01", "3M34 5M56", 36, 40, "Sala 04 IC", true, List.of(doc("LEANDRO DIAS DA SILVA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM007", "LÓGICA APLICADA À COMPUTAÇÃO", 60, false, "01", "35T34", 30, 55, "Auditório IC", true, List.of(doc("EVANDRO DE BARROS COSTA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM003", "MATEMÁTICA DISCRETA", 60, false, "01", "24M12", 49, 75, "Auditório IC", true, List.of(doc("BRUNO ALMEIDA PIMENTEL", 60))));
        lista.add(new OfertaRegistro("EC", "ECIV018", "MECÂNICA DOS SÓLIDOS 1", 60, false, "01", "24T34", 31, 42, "CTEC", false, List.of(doc("PAULO CESAR CORREIA GOMES", 60))));
        lista.add(new OfertaRegistro("EC", "ECIV018", "MECÂNICA DOS SÓLIDOS 1", 60, false, "02", "24M34", 42, 42, "CTEC", false, List.of(doc("WAYNE SANTOS DE ASSIS", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM018", "METODOLOGIA DA PESQUISA E DO TRABALHO CIENTÍFICO", 30, false, "01", "2M34", 31, 31, "Sala 04 IC", true, List.of(doc("JÚLIA GABRIELE LIMA DA ROSA", 30))));
        lista.add(new OfertaRegistro("EC", "ECOM036", "MÉTODOS NUMÉRICOS", 60, false, "01", "2T56 6T12", 36, 42, "Sala 02 IC", true, List.of(doc("THALES MIRANDA DE ALMEIDA VIEIRA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM059", "MICROCONTROLADORES E APLICAÇÕES", 60, true, "01", "24M34", 25, 30, "Laboratório 02 - IC", true, List.of(doc("ERICK DE ANDRADE BARBOZA", 60))));
        lista.add(new OfertaRegistro("EC", "COMP387", "NOÇÕES DE DIREITO", 72, false, "01", "6T1234", 56, 70, "Auditório CEPETEC", true, List.of(doc("CID CAVALCANTI DE ALBUQUERQUE", 72))));
        lista.add(new OfertaRegistro("EC", "ECOM025", "ORGANIZAÇÃO E ARQUITETURA DE COMPUTADORES", 60, false, "01", "24T34", 28, 35, "Sala 03 IC", true, List.of(doc("ERICK DE ANDRADE BARBOZA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM034", "PRINCÍPIOS DE COMUNICAÇÃO", 60, true, "01", "24T34", 29, 33, "Laboratório 02 - IC", true, List.of(doc("JOBSON DE ARAUJO NASCIMENTO", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM020", "PROBABILIDADE E ESTATÍSTICA", 60, false, "01", "24T12", 47, 50, "Auditório IC", true, List.of(doc("GLAUBER RODRIGUES LEITE", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM179", "PROCESSAMENTO DE LINGUAGEM NATURAL", 60, false, "01", "26T34", 41, 41, "Sala 04 IC", true, List.of(doc("THALES MIRANDA DE ALMEIDA VIEIRA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM063", "PROCESSAMENTO DIGITAL DE SINAIS", 60, false, "01", "24M12", 34, 40, "Sala 02 IC", true, List.of(doc("JOBSON DE ARAUJO NASCIMENTO", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM002", "PROGRAMAÇÃO 1", 60, true, "01", "6M3456", 39, 50, "Laboratório 02 - IC", true, List.of(doc("WILLY CARVALHO TIENGO", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM087", "PROJETO DE SISTEMAS EMBARCADOS", 60, true, "01", "35M56", 14, 30, "Laboratório 04 - IC", true, List.of(doc("RODRIGO JOSE SARMENTO PEIXOTO", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM015", "PROJETO DE SOFTWARE", 60, true, "01", "4M3456", 21, 30, "Laboratório 03 - IC", true, List.of(doc("BALDOINO FONSECA DOS SANTOS NETO", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM027", "PROJETO E ANÁLISE DE ALGORITMOS", 60, true, "01", "25M56", 49, 55, "Laboratório 01 - IC", true, List.of(doc("RIAN GABRIEL SANTOS PINHEIRO", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM027", "PROJETO E ANÁLISE DE ALGORITMOS", 60, true, "03", "25T56", 27, 55, "Laboratório 01 - IC", true, List.of(doc("RIAN GABRIEL SANTOS PINHEIRO", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM057", "QUÍMICA TECNOLÓGICA", 60, false, "01", "36M56", 58, 60, "Sala 02 IC", true, List.of(doc("RUTH RUFINO DO NASCIMENTO", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM029", "REDES DE COMPUTADORES", 60, true, "01", "34M56", 54, 55, "Laboratório 01 - IC", true, List.of(doc("ALMIR PEREIRA GUIMARAES", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM189", "REUSO DE SOFTWARE E METODOLOGIAS ÁGEIS", 30, true, "01", "3M56", 16, 30, "Laboratório 02 - IC", true, List.of(doc("ARTURO HERNANDEZ DOMINGUEZ", 30))));
        lista.add(new OfertaRegistro("EC", "ECOM062", "ROBÓTICA", 60, true, "01", "24T56", 15, 30, "Laboratório 04 - IC", true, List.of(doc("GLAUBER RODRIGUES LEITE", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM030", "SINAIS E SISTEMAS", 90, false, "01", "5M12 6M3456", 34, 35, "Sala 04 IC", true, List.of(doc("TIAGO ALVES DE ALMEIDA", 90))));
        lista.add(new OfertaRegistro("EC", "ECOM037", "SISTEMAS DE CONTROLE 1", 60, false, "01", "4T12 6T34", 19, 30, "Sala 04 IC", true, List.of(doc("TIAGO ALVES DE ALMEIDA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM058", "SISTEMAS DE CONTROLE 2", 60, false, "01", "5M34 6M12", 24, 30, "Sala 04 IC", true, List.of(doc("TIAGO ALVES DE ALMEIDA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM095", "SISTEMAS DE TEMPO REAL E APLICAÇÕES", 60, false, "01", "5T1234", 12, 40, "Sala 206 BL12", true, List.of(doc("BRUNO COSTA E SILVA NOGUEIRA", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM019", "SISTEMAS DIGITAIS", 60, false, "01", "56M34", 30, 31, "Sala 206 BL12", true, List.of(doc("BRUNO COSTA E SILVA NOGUEIRA", 60))));
        lista.add(new OfertaRegistro("EC", "COMP392", "SISTEMAS DISTRIBUÍDOS", 72, true, "02", "35M56", 44, 60, "LCCV", true, List.of(doc("LEANDRO MELO DE SALES", 72))));
        lista.add(new OfertaRegistro("EC", "ECOM042", "SISTEMAS EMBARCADOS", 60, true, "01", "35T34", 15, 30, "Laboratório 04 - IC", true, List.of(doc("RODRIGO JOSE SARMENTO PEIXOTO", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM032", "SISTEMAS OPERACIONAIS", 60, false, "01", "24M34", 50, 50, "Sala 207 BL12", true, List.of(doc("ANDRE LUIZ LINS DE AQUINO", 60))));
        lista.add(new OfertaRegistro("EC", "ECOM033", "TEORIA DOS GRAFOS", 30, false, "01", "2T12", 28, 30, "Sala 04 IC", true, List.of(doc("RIAN GABRIEL SANTOS PINHEIRO", 30))));
        lista.add(new OfertaRegistro("EC", "ECOM125", "TÓP EM ENG DE SOFTWARE:PROJETANDO LINHAS DE PROD DE SOFTWARE", 30, true, "01", "4T12", 27, 30, "Laboratório 02 - IC", true, List.of(doc("ARTURO HERNANDEZ DOMINGUEZ", 30))));
        lista.add(new OfertaRegistro("EC", "ECOM024", "VARIÁVEIS COMPLEXAS", 60, false, "01", "35T12", 33, 40, "Sala 03 IC", true, List.of(doc("ARTURO JIMENEZ LOAIZA", 60))));

        return lista;
    }
}
