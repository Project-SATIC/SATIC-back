package model;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * Entidade de Domínio representando um Docente do Instituto de Computação.
 */
public class Professor {

    private String matriculaSiape;
    private String nome;
    private List<IndisponibilidadeDocente> indisponibilidades;

    public Professor() {
        this.indisponibilidades = new ArrayList<>();
    }

    public Professor(String matriculaSiape, String nome) {
        this.matriculaSiape = matriculaSiape;
        this.nome = nome;
        this.indisponibilidades = new ArrayList<>();
    }

    public String getMatriculaSiape() {
        return matriculaSiape;
    }

    public void setMatriculaSiape(String matriculaSiape) {
        this.matriculaSiape = matriculaSiape;
    }

    public String getNome() {
        return nome;
    }

    public void setNome(String nome) {
        this.nome = nome;
    }

    public List<IndisponibilidadeDocente> getIndisponibilidades() {
        return indisponibilidades;
    }

    public void setIndisponibilidades(List<IndisponibilidadeDocente> indisponibilidades) {
        this.indisponibilidades = indisponibilidades;
    }

    public void adicionarIndisponibilidade(IndisponibilidadeDocente ind) {
        this.indisponibilidades.add(ind);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Professor professor = (Professor) o;
        return Objects.equals(matriculaSiape, professor.matriculaSiape);
    }

    @Override
    public int hashCode() {
        return Objects.hash(matriculaSiape);
    }

    @Override
    public String toString() {
        return "Professor{" +
                "matriculaSiape='" + matriculaSiape + '\'' +
                ", nome='" + nome + '\'' +
                ", indisponibilidades=" + indisponibilidades.size() +
                '}';
    }
}
