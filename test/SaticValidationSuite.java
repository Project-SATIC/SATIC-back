import config.DatabaseConnection;
import dao.*;
import model.*;
import service.SigaaHorarioParser;
import service.ValidadorDeRestricoes;

import java.io.File;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Suíte completa de testes unitários, de regressão, busca e integração SQLite para o SATIC-back.
 */
public class SaticValidationSuite {

    private static int testesPassados = 0;

    private static void assertTrue(boolean condicao, String mensagem) {
        if (!condicao) {
            throw new AssertionError("FALHA: " + mensagem);
        }
        testesPassados++;
    }

    private static void assertFalse(boolean condicao, String mensagem) {
        assertTrue(!condicao, mensagem);
    }

    public static void main(String[] args) throws Exception {
        testarParserSigaa();
        testarModeloSalaEContratoEquals();
        testarValidadorDeRestricoesCompleto();
        testarMotorDeBuscaHeuristicaEFallback();
        testarIntegracaoSqliteEDaos();

        System.out.println("[SATIC-TEST] Todos os " + testesPassados + " testes (unitários, busca e integração SQLite) passaram com sucesso!");
    }

    private static void testarParserSigaa() {
        assertTrue(SigaaHorarioParser.haSobreposicao("6M3456", "6M34"), "Sobreposição parcial 6M3456 vs 6M34");
        assertTrue(SigaaHorarioParser.haSobreposicao("2T56 6T12", "6T1234"), "Sobreposição em horário composto");
        assertFalse(SigaaHorarioParser.haSobreposicao("35T12", "35T34"), "Horários adjacentes não devem colidir");
        assertTrue(SigaaHorarioParser.obterConjuntoSlots("7M45").contains("SAB-M4"), "Suporte a sábado (7)");
        assertTrue(SigaaHorarioParser.obterConjuntoSlots("4N1234").contains("QUA-N4"), "Suporte a noturno (N)");

        boolean lancouErroFormato = false;
        try {
            SigaaHorarioParser.obterConjuntoSlots("9X99");
        } catch (IllegalArgumentException ex) {
            lancouErroFormato = true;
        }
        assertTrue(lancouErroFormato, "Parser deve rejeitar código SIGAA malformado");
    }

    private static void testarModeloSalaEContratoEquals() {
        Sala sala = new Sala("Sala 01 - IM", 30, "Sala", "IM", true);
        Sala auditorio = new Sala("Auditório IC", 76, "Auditório", "IC", true);
        Sala labAcento = new Sala("Lab 01", 65, "Laboratório", "IC", true);
        Sala labSemAcento = new Sala("Lab 02", 40, "laboratorio", "IC", true);

        assertFalse(sala.isLaboratorio(), "tipoEspaco='Sala' não deve ser laboratório");
        assertFalse(auditorio.isLaboratorio(), "tipoEspaco='Auditório' não deve ser laboratório");
        assertTrue(labAcento.isLaboratorio(), "tipoEspaco='Laboratório' deve derivar isLaboratorio=true");
        assertTrue(labSemAcento.isLaboratorio(), "tipoEspaco='laboratorio' sem acento também deve ser aceito");

        // Regressão: duas salas não persistidas (id=null) com nomes distintos não podem ser iguais
        assertFalse(sala.equals(auditorio), "Salas com id=null e nomes distintos não devem colidir no equals()");

        Sala salaComId = new Sala(10, "Sala 01 - IM", 30, "Sala", "IM", true);
        assertTrue(sala.equals(salaComId) && salaComId.equals(sala), "Salas com mesmo nome único devem manter simetria no equals()");
        assertTrue(sala.hashCode() == salaComId.hashCode(), "Contrato equals/hashCode deve bater para mesma sala");
    }

    private static void testarValidadorDeRestricoesCompleto() {
        ValidadorDeRestricoes validador = new ValidadorDeRestricoes();

        Sala salaPequena = new Sala(1, "Sala 01 - IM", 30, "Sala", "IM", true);
        Sala labGrande = new Sala(2, "Laboratório 01 - IC", 65, "Laboratório", "IC", true);

        Professor profRanilson = new Professor("2024389", "RANILSON PAIVA");
        profRanilson.adicionarIndisponibilidade(new IndisponibilidadeDocente("2024389", "SEX", "T", "56"));

        Professor profAlan = new Professor("1002", "ALAN PEDRO");
        Professor profWilly = new Professor("1003", "WILLY TIENGO");

        Disciplina p3 = new Disciplina("COMP373", "Programação 3", 72, true);
        Disciplina teoria = new Disciplina("COMP370", "Probabilidade", 72, false);
        Disciplina pds = new Disciplina("COMP382", "PDS", 72, false);

        // RN-03 Capacidade
        Turma turmaLotada = new Turma(1, teoria, "01", "2026.2", "CC", "35M34", 45, 45, true);
        assertFalse(validador.verificarCapacidade(turmaLotada, salaPequena), "RN-03 deve rejeitar 45 alunos em sala de 30");
        assertTrue(validador.verificarCapacidade(turmaLotada, labGrande), "RN-03 deve aceitar 45 alunos em espaço de 65");

        // RN-04 Laboratório via tipoEspaco
        Turma turmaLab = new Turma(2, p3, "02", "2026.2", "CC", "35T34", 30, 30, true);
        assertFalse(validador.verificarRequisitoLab(turmaLab, salaPequena), "RN-04 deve rejeitar prática em 'Sala'");
        assertTrue(validador.verificarRequisitoLab(turmaLab, labGrande), "RN-04 deve aceitar 'Laboratório'");

        // RN-02 Indisponibilidade Docente
        Turma turmaBloqueada = new Turma(3, teoria, "01", "2026.2", "CC", "6T56", 20, 20, true);
        turmaBloqueada.adicionarProfessor(profRanilson);
        assertFalse(validador.verificarIndisponibilidade(turmaBloqueada), "RN-02 deve bloquear SEX T56 para Ranilson");

        Turma turmaLivre = new Turma(4, p3, "02", "2026.2", "CC", "35T34", 30, 30, true);
        turmaLivre.adicionarProfessor(profRanilson);
        assertTrue(validador.verificarIndisponibilidade(turmaLivre), "RN-02 deve liberar 35T34 para Ranilson");

        // RN-01 Choque Docente com Co-docência
        Turma turmaPds = new Turma(5, pds, "01", "2026.2", "CC", "2345M3456", 40, 40, true);
        turmaPds.adicionarProfessor(profAlan);
        turmaPds.adicionarProfessor(profWilly);
        Alocacao alocPds = new Alocacao(turmaPds, labGrande, turmaPds.getHorarioSigaa());

        Turma turmaWillyChoque = new Turma(6, teoria, "01", "2026.2", "EC", "3M34", 25, 25, true);
        turmaWillyChoque.adicionarProfessor(profWilly);
        assertFalse(validador.verificarChoqueProfessor(turmaWillyChoque, List.of(alocPds)),
                "RN-01 deve detectar choque de co-docente (Willy em 2345M3456 vs 3M34)");

        // Exclusividade de Sala + diagnóstico
        Turma turmaConcorrente = new Turma(7, teoria, "02", "2026.2", "CC", "2M34", 25, 25, true);
        turmaConcorrente.adicionarProfessor(profRanilson);
        assertFalse(validador.verificarChoqueSala(turmaConcorrente, labGrande, List.of(alocPds)),
                "Choque de sala deve impedir duas turmas na mesma sala no horário 2M34");

        Turma turmaSemChoque = new Turma(8, teoria, "03", "2026.2", "CC", "2T12", 25, 25, true);
        turmaSemChoque.adicionarProfessor(profRanilson);
        assertTrue(validador.verificarChoqueSala(turmaSemChoque, labGrande, List.of(alocPds)),
                "Horário distinto na mesma sala deve ser permitido");
        assertTrue(validador.isAlocacaoValida(turmaSemChoque, salaPequena, List.of(alocPds)),
                "isAlocacaoValida deve retornar true quando todas as regras passam");

        List<String> violacoes = validador.diagnosticarViolacoes(turmaBloqueada, labGrande, List.of(alocPds));
        assertTrue(violacoes.size() == 1 && violacoes.get(0).contains("RN-02"),
                "Diagnóstico deve apontar exatamente violação RN-02");
    }

    private static void testarMotorDeBuscaHeuristicaEFallback() {
        ValidadorDeRestricoes validador = new ValidadorDeRestricoes();

        Sala salaIm = new Sala(1, "Sala 01 - IM", 30, "Sala", "IM", true);
        Sala salaIc = new Sala(2, "Sala 02 IC", 60, "Sala", "IC", true);
        Sala labIc = new Sala(3, "Laboratório 03 - IC", 30, "Laboratório", "IC", true);

        Disciplina teoria = new Disciplina("COMP370", "Probabilidade", 72, false);
        Professor prof = new Professor("2024389", "RANILSON PAIVA");
        prof.adicionarIndisponibilidade(new IndisponibilidadeDocente("2024389", "SEX", "T", "56"));

        // Cenário A: Soft Constraint Best-Fit preserva laboratório e evita sala superdimensionada
        Turma turmaPequena = new Turma(10, teoria, "01", "2026.2", "CC", "35M34", 25, 25, true);
        turmaPequena.adicionarProfessor(prof);
        StateSpaceSearch buscaBestFit = new StateSpaceSearch(List.of(turmaPequena), List.of(labIc, salaIc, salaIm), validador);
        StateSpaceSearch.ResultadoBusca resBestFit = buscaBestFit.solve();
        assertTrue(resBestFit.isCompleto(), "Busca Best-Fit deve concluir com 100% de alocação");
        assertTrue("Sala 01 - IM".equals(resBestFit.getAlocacoes().get(0).getSala().getNome()),
                "Turma teórica de 25 alunos deve escolher Sala 01 - IM (30) em vez de Lab 03 (30) ou Sala 02 IC (60)");

        // Cenário B: Bloqueio RN-02 deve devolver solução parcial preservando turma válida
        Turma turmaBloqueada = new Turma(11, teoria, "02", "2026.2", "CC", "6T56", 20, 20, true);
        turmaBloqueada.adicionarProfessor(prof);
        StateSpaceSearch buscaParcial = new StateSpaceSearch(List.of(turmaPequena, turmaBloqueada), List.of(salaIm, salaIc), validador);
        StateSpaceSearch.ResultadoBusca resParcial = buscaParcial.solve();
        assertFalse(resParcial.isCompleto(), "Busca com bloqueio RN-02 deve reportar solução parcial");
        assertTrue(resParcial.getAlocacoes().size() == 1 && resParcial.getTurmasPendentes().size() == 1,
                "Solução parcial deve alocar 1 turma válida e listar 1 pendente");

        // Cenário C: Turma com domínio zero (sem sala comportando 120 alunos) no topo do MRV não impede alocar demais
        Turma turmaGigante = new Turma(12, teoria, "03", "2026.2", "CC", "24T12", 120, 120, true);
        StateSpaceSearch buscaDomZero = new StateSpaceSearch(List.of(turmaGigante, turmaPequena), List.of(salaIm, salaIc), validador);
        StateSpaceSearch.ResultadoBusca resDomZero = buscaDomZero.solve();
        assertFalse(resDomZero.isCompleto(), "Turma acima de todas as capacidades deve tornar resultado parcial");
        assertTrue(resDomZero.getAlocacoes().size() == 1 && resDomZero.getTurmasPendentes().size() == 1,
                "Fallback deve recuperar turma válida mesmo com domínio 0 no início do MRV");
        assertTrue(resDomZero.getTurmasPendentes().get(0).equals(turmaGigante),
                "A turma pendente deve ser exatamente a turma superlotada");
    }

    private static void testarIntegracaoSqliteEDaos() throws SQLException {
        String testDbPath = "data/satic_test_suite.db";
        File testDbFile = new File(testDbPath);
        if (testDbFile.exists()) {
            testDbFile.delete();
        }

        try {
            DatabaseConnection.useDatabasePath(testDbPath);
            DatabaseInitializer.initialize();

            // 1. Verifica schema físico da tabela salas sem coluna is_laboratorio
            Set<String> colunasSalas = new HashSet<>();
            try (Connection conn = DatabaseConnection.getConnection();
                 Statement stmt = conn.createStatement();
                 ResultSet rs = stmt.executeQuery("PRAGMA table_info(salas);")) {
                while (rs.next()) {
                    colunasSalas.add(rs.getString("name"));
                }
            }
            assertFalse(colunasSalas.contains("is_laboratorio"), "Tabela 'salas' não deve conter coluna redundante 'is_laboratorio'");
            assertTrue(colunasSalas.contains("tipo_espaco") && colunasSalas.contains("bloco") && colunasSalas.contains("alocavel_ic"),
                    "Tabela 'salas' deve conter tipo_espaco, bloco e alocavel_ic");

            // 2. CRUD SalaDAO + filtro alocavel_ic
            SalaDAO salaDAO = new SalaDAO();
            Sala labIc = new Sala("Lab Teste IC", 40, "Laboratório", "IC", true);
            Sala salaExt = new Sala("Sala Teste CTEC", 50, "Sala", "CTEC", false);
            salaDAO.inserir(labIc);
            salaDAO.inserir(salaExt);
            assertTrue(labIc.getId() != null && salaDAO.buscarPorId(labIc.getId()).isPresent(), "SalaDAO deve persistir e buscar por ID");
            assertTrue(salaDAO.listarTodas().size() == 2 && salaDAO.listarAlocaveisPeloIc().size() == 1,
                    "SalaDAO.listarAlocaveisPeloIc deve filtrar apenas espaços do IC");

            labIc.setCapacidade(45);
            salaDAO.atualizar(labIc);
            assertTrue(salaDAO.buscarPorNome("Lab Teste IC").orElseThrow().getCapacidade() == 45,
                    "SalaDAO.atualizar deve refletir alteração de capacidade");

            // 3. DisciplinaDAO + ProfessorDAO + Indisponibilidade + FK enforcement
            DisciplinaDAO discDAO = new DisciplinaDAO();
            Disciplina d1 = new Disciplina("COMP999", "Disciplina Teste", 72, true);
            discDAO.inserir(d1);
            assertTrue(discDAO.buscarPorCodigo("COMP999").orElseThrow().isExigeLaboratorio(),
                    "DisciplinaDAO deve persistir requisito de laboratório");

            ProfessorDAO profDAO = new ProfessorDAO();
            Professor p1 = new Professor("9001", "DOCENTE A");
            Professor p2 = new Professor("9002", "DOCENTE B");
            profDAO.inserir(p1);
            profDAO.inserir(p2);
            profDAO.inserirIndisponibilidade(new IndisponibilidadeDocente("9002", "TER", "M", "34"));

            boolean fkBloqueouInvalido = false;
            try {
                profDAO.inserirIndisponibilidade(new IndisponibilidadeDocente("INEXISTENTE", "SEG", "M", "12"));
            } catch (SQLException ex) {
                fkBloqueouInvalido = true;
            }
            assertTrue(fkBloqueouInvalido, "PRAGMA foreign_keys = ON deve impedir indisponibilidade para docente inexistente");

            // 4. TurmaDAO (co-docência + hidratação de indisponibilidades em buscarPorId e listarTodas)
            TurmaDAO turmaDAO = new TurmaDAO();
            Turma t = new Turma(d1, "01", "2026.2", "CC, EC", "35M34", 40, 35, true);
            t.adicionarProfessor(p1, 36);
            t.adicionarProfessor(p2, 36);
            turmaDAO.inserir(t);
            assertTrue(t.getId() != null, "TurmaDAO deve atribuir ID autogerado");

            boolean bloqueouTurmaDuplicada = false;
            try {
                Turma tDup = new Turma(d1, "01", "2026.2", "EC", "24T12", 40, 30, true);
                turmaDAO.inserir(tDup);
            } catch (SQLException ex) {
                bloqueouTurmaDuplicada = true;
            }
            assertTrue(bloqueouTurmaDuplicada, "UNIQUE(semestre, disciplina_codigo, codigo_turma) deve barrar duplicidade");

            Turma carregadaPorId = turmaDAO.buscarPorId(t.getId()).orElseThrow();
            assertTrue(carregadaPorId.getProfessores().size() == 2, "TurmaDAO.buscarPorId deve carregar todos os co-docentes");
            ValidadorDeRestricoes validador = new ValidadorDeRestricoes();
            assertFalse(validador.verificarIndisponibilidade(carregadaPorId),
                    "TurmaDAO.buscarPorId deve hidratar indisponibilidades para detectar conflito RN-02 (TER M34)");

            // 5. AlocacaoDAO + auditoria pós-persistência com indisponibilidade hidratada
            AlocacaoDAO alocDAO = new AlocacaoDAO();
            alocDAO.inserir(new Alocacao(carregadaPorId, labIc, carregadaPorId.getHorarioSigaa(), "RASCUNHO"));
            List<Alocacao> alocacoesDb = alocDAO.listarTodas();
            assertTrue(alocacoesDb.size() == 1, "AlocacaoDAO deve retornar alocação persistida");
            assertTrue(alocacoesDb.get(0).getSala().isLaboratorio(), "Sala carregada via AlocacaoDAO deve derivar isLaboratorio=true");

            List<String> diagDb = validador.diagnosticarViolacoes(
                    alocacoesDb.get(0).getTurma(),
                    alocacoesDb.get(0).getSala(),
                    alocacoesDb
            );
            assertTrue(diagDb.size() == 1 && diagDb.get(0).contains("RN-02"),
                    "AlocacaoDAO.listarTodas deve hidratar indisponibilidades permitindo auditoria real RN-02");

            // 6. Deleção limpa (limpa alocação antes por causa de ON DELETE RESTRICT em sala)
            alocDAO.limparTodas();
            turmaDAO.deletar(t.getId());
            discDAO.deletar("COMP999");
            profDAO.deletar("9001");
            profDAO.deletar("9002");
            salaDAO.deletar(labIc.getId());
            salaDAO.deletar(salaExt.getId());
            assertTrue(salaDAO.listarTodas().isEmpty() && turmaDAO.listarTodas().isEmpty(),
                    "Operações DELETE em cascata/ordem relacional devem limpar o banco");

        } finally {
            DatabaseConnection.resetDefaultDatabase();
            if (testDbFile.exists()) {
                testDbFile.delete();
            }
        }
    }
}
