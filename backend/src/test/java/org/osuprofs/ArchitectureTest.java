package org.osuprofs;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import javax.tools.ToolProvider;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ArchitectureTest {
    @TempDir Path compiledCore;
    @Test void coreCompilesWithoutAnyFrameworkOnItsClasspath() throws Exception {
        List<Path> sources = new ArrayList<>();
        for (String area : new String[]{"domain", "application"}) {
            try (var paths = Files.walk(Path.of("src/main/java/org/osuprofs/" + area))) {
                for (Path file : paths.filter(p -> p.toString().endsWith(".java")).toList()) {
                    sources.add(file);
                    for (String line : Files.readAllLines(file)) {
                        if (!line.startsWith("import ")) continue;
                        assertTrue(line.startsWith("import java.") || line.startsWith("import org.osuprofs.domain.") ||
                            area.equals("application") && line.startsWith("import org.osuprofs.application."),
                            () -> file + " violates the hexagonal boundary: " + line);
                    }
                }
            }
        }
        var compiler = ToolProvider.getSystemJavaCompiler();
        assertNotNull(compiler, "Run architecture checks with a JDK");
        try (var manager = compiler.getStandardFileManager(null, null, null)) {
            // An empty output directory is the entire classpath; Spring/JPA/Jackson cannot be resolved.
            var options = List.of("--release", "21", "-classpath", compiledCore.toString(), "-d", compiledCore.toString());
            assertTrue(compiler.getTask(null, manager, null, options, null, manager.getJavaFileObjectsFromPaths(sources)).call(),
                "Domain and application must compile against Java alone");
        }
    }
}
