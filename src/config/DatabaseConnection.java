package config;

import java.io.File;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;

/**
 * Gerenciador de conexão com o banco de dados SQLite para o SATIC.
 * Assegura a criação do diretório de armazenamento e a ativação
 * obrigatória de integridade de Chaves Estrangeiras (PRAGMA foreign_keys = ON).
 */
public class DatabaseConnection {

    private static final String DEFAULT_DB_DIR = "data";
    private static final String DEFAULT_DB_FILE = "satic.db";
    private static String activeDbPath = DEFAULT_DB_DIR + "/" + DEFAULT_DB_FILE;

    static {
        ensureParentDirectory(activeDbPath);
        try {
            Class.forName("org.sqlite.JDBC");
        } catch (ClassNotFoundException e) {
            System.err.println("[SATIC-DB] Driver SQLite não encontrado no classpath: " + e.getMessage());
        }
    }

    private static void ensureParentDirectory(String path) {
        File parent = new File(path).getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }
    }

    /**
     * Configura um arquivo SQLite alternativo (útil para suítes de testes isoladas).
     */
    public static void useDatabasePath(String path) {
        if (path == null || path.isBlank()) {
            resetDefaultDatabase();
            return;
        }
        ensureParentDirectory(path);
        activeDbPath = path;
    }

    /**
     * Restaura o caminho padrão do banco de dados (data/satic.db).
     */
    public static void resetDefaultDatabase() {
        activeDbPath = DEFAULT_DB_DIR + "/" + DEFAULT_DB_FILE;
        ensureParentDirectory(activeDbPath);
    }

    /**
     * Obtém uma nova conexão ativa com o SQLite configurada para respeitar Foreign Keys.
     * 
     * @return Connection ativa
     * @throws SQLException caso ocorra falha na abertura
     */
    public static Connection getConnection() throws SQLException {
        Connection conn = DriverManager.getConnection("jdbc:sqlite:" + activeDbPath);
        
        // No SQLite, o suporte a chaves estrangeiras precisa ser ativado explicitamente por conexão
        try (Statement stmt = conn.createStatement()) {
            stmt.execute("PRAGMA foreign_keys = ON;");
        }
        
        return conn;
    }

    public static String getDatabasePath() {
        return new File(activeDbPath).getAbsolutePath();
    }
}
