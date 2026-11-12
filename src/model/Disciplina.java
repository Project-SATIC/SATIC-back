package model;

import java.util.Objects;

/**
 * Entidade de Domínio representando um componente curricular ofertado.
 */
public class Disciplina {

    private String codigo;          // ex: "COMP373"
    private String nome;            // ex: "Programação 3"
    private int cargaHoraria;       // ex: 60
    private boolean exigeLaboratorio; // RN-04: true se requer laboratório de computação

    public Disciplina() {
    }

    public Disciplina(String codigo, String nome, int cargaHoraria, boolean exigeLaboratorio) {
        this.codigo = codigo;
        this.nome = nome;
        this.cargaHoraria = cargaHoraria;
        this.exigeLaboratorio = exigeLaboratorio;
    }

    public String getCodigo() {
        return codigo;
    }

    public void setCodigo(String codigo) {
        this.codigo = codigo;
    }

    public String getNome() {
        return nome;
    }

    public void setNome(String nome) {
        this.nome = nome;
    }

    public int getCargaHoraria() {
        return cargaHoraria;
    }

    public void setCargaHoraria(int cargaHoraria) {
        this.cargaHoraria = cargaHoraria;
    }

    public boolean isExigeLaboratorio() {
        return exigeLaboratorio;
    }

    public void setExigeLaboratorio(boolean exigeLaboratorio) {
        this.exigeLaboratorio = exigeLaboratorio;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Disciplina that = (Disciplina) o;
        return Objects.equals(codigo, that.codigo);
    }

    @Override
    public int hashCode() {
        return Objects.hash(codigo);
    }

    @Override
    public String toString() {
        return "Disciplina{" +
                "codigo='" + codigo + '\'' +
                ", nome='" + nome + '\'' +
                ", cargaHoraria=" + cargaHoraria +
                ", exigeLaboratorio=" + exigeLaboratorio +
                '}';
    }
}
