package model;

import java.util.*;

/**
 * Entidade de Domínio representando uma Turma física única no contexto de Pós-Oferta Acadêmica.
 * Suporta co-docência (N:M com Professor) e ofertas conjuntas para múltiplos cursos (ex: "CC, EC").
 */
public class Turma {

    private Integer id;
    private Disciplina disciplina;
    private List<Professor> professores;
    private Map<String, Integer> cargaHorariaPorDocente;
    private String codigoTurma;       // ex: "01", "02", "03"
    private String semestre;          // ex: "2026.2"
    private String cursosOfertados;   // ex: "CC", "EC", "CC, EC"
    private String horarioSigaa;      // ex: "35M34", "2T56 6T12"
    private int vagas;                // capacidade ofertada no SIGAA
    private int matriculados;         // alunos efetivamente matriculados
    private boolean requerAlocacaoIc; // false para turmas em outros institutos (CTEC/IF)

    public Turma() {
        this.professores = new ArrayList<>();
        this.cargaHorariaPorDocente = new LinkedHashMap<>();
        this.requerAlocacaoIc = true;
    }

    public Turma(Integer id, Disciplina disciplina, String codigoTurma, String semestre,
                 String cursosOfertados, String horarioSigaa, int vagas, int matriculados,
                 boolean requerAlocacaoIc) {
        this.id = id;
        this.disciplina = disciplina;
        this.codigoTurma = codigoTurma;
        this.semestre = semestre;
        this.cursosOfertados = cursosOfertados;
        this.horarioSigaa = horarioSigaa;
        this.vagas = vagas;
        this.matriculados = matriculados;
        this.requerAlocacaoIc = requerAlocacaoIc;
        this.professores = new ArrayList<>();
        this.cargaHorariaPorDocente = new LinkedHashMap<>();
    }

    public Turma(Disciplina disciplina, String codigoTurma, String semestre,
                 String cursosOfertados, String horarioSigaa, int vagas, int matriculados,
                 boolean requerAlocacaoIc) {
        this(null, disciplina, codigoTurma, semestre, cursosOfertados, horarioSigaa, vagas, matriculados, requerAlocacaoIc);
    }

    public void adicionarProfessor(Professor professor, int cargaHorariaDocente) {
        if (professor != null && !this.professores.contains(professor)) {
            this.professores.add(professor);
            this.cargaHorariaPorDocente.put(professor.getMatriculaSiape(), cargaHorariaDocente);
        }
    }

    public void adicionarProfessor(Professor professor) {
        adicionarProfessor(professor, disciplina != null ? disciplina.getCargaHoraria() : 60);
    }

    public Integer getId() {
        return id;
    }

    public void setId(Integer id) {
        this.id = id;
    }

    public Disciplina getDisciplina() {
        return disciplina;
    }

    public void setDisciplina(Disciplina disciplina) {
        this.disciplina = disciplina;
    }

    public List<Professor> getProfessores() {
        return professores;
    }

    public void setProfessores(List<Professor> professores) {
        this.professores = professores != null ? professores : new ArrayList<>();
    }

    public Map<String, Integer> getCargaHorariaPorDocente() {
        return cargaHorariaPorDocente;
    }

    public String getCodigoTurma() {
        return codigoTurma;
    }

    public void setCodigoTurma(String codigoTurma) {
        this.codigoTurma = codigoTurma;
    }

    public String getSemestre() {
        return semestre;
    }

    public void setSemestre(String semestre) {
        this.semestre = semestre;
    }

    public String getCursosOfertados() {
        return cursosOfertados;
    }

    public void setCursosOfertados(String cursosOfertados) {
        this.cursosOfertados = cursosOfertados;
    }

    public String getHorarioSigaa() {
        return horarioSigaa;
    }

    public void setHorarioSigaa(String horarioSigaa) {
        this.horarioSigaa = horarioSigaa;
    }

    public int getVagas() {
        return vagas;
    }

    public void setVagas(int vagas) {
        this.vagas = vagas;
    }

    public int getMatriculados() {
        return matriculados;
    }

    public void setMatriculados(int matriculados) {
        this.matriculados = matriculados;
    }

    /**
     * Retorna a demanda efetiva de alunos para verificação de capacidade física (RN-03).
     */
    public int getNumeroAlunos() {
        return matriculados > 0 ? matriculados : vagas;
    }

    public boolean isRequerAlocacaoIc() {
        return requerAlocacaoIc;
    }

    public void setRequerAlocacaoIc(boolean requerAlocacaoIc) {
        this.requerAlocacaoIc = requerAlocacaoIc;
    }

    public String getIdentificadorExibicao() {
        String cod = disciplina != null ? disciplina.getCodigo() : "???";
        String nome = disciplina != null ? disciplina.getNome() : "Sem Disciplina";
        return String.format("[%s] %s (T%s) [%s]", cod, nome, codigoTurma, cursosOfertados);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Turma turma = (Turma) o;
        if (id != null && turma.id != null) {
            return Objects.equals(id, turma.id);
        }
        return Objects.equals(semestre, turma.semestre) &&
                Objects.equals(disciplina, turma.disciplina) &&
                Objects.equals(codigoTurma, turma.codigoTurma);
    }

    @Override
    public int hashCode() {
        return Objects.hash(semestre, disciplina, codigoTurma);
    }

    @Override
    public String toString() {
        return "Turma{" +
                "id=" + id +
                ", display='" + getIdentificadorExibicao() + '\'' +
                ", horario='" + horarioSigaa + '\'' +
                ", mat/cap=" + matriculados + "/" + vagas +
                ", docentes=" + professores.size() +
                '}';
    }
}
