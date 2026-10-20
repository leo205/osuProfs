package org.osuprofs.adapter.in.cli;

import org.osuprofs.application.port.in.ImportCatalog;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Arrays;
import java.util.Locale;

@Component
@ConditionalOnProperty(name="app.import.enabled", havingValue="true")
public class ImportCommand implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(ImportCommand.class);
    private final ImportCatalog importer;
    private final Environment environment;
    public ImportCommand(ImportCatalog importer, Environment environment) { this.importer = importer; this.environment = environment; }
    @Override public void run(ApplicationArguments args) throws Exception {
        var result = importer.run(new ImportCatalog.Request(environment.getRequiredProperty("app.import.term"),
            environment.getRequiredProperty("app.import.campus").toLowerCase(Locale.ROOT),
            Arrays.stream(environment.getRequiredProperty("app.import.subjects").split(",")).map(String::strip)
                .filter(s -> !s.isEmpty()).map(s -> s.toUpperCase(Locale.ROOT)).toList(),
            environment.getRequiredProperty("app.import.output"),
            environment.getProperty("app.import.max-drop-fraction", Double.class, 0.25),
            environment.getProperty("app.import.allow-large-drop", Boolean.class, false)));
        log.info("Published {} courses / {} sections to {} at {}", result.courses().size(),
            result.courses().stream().mapToInt(c -> c.sections().size()).sum(), environment.getProperty("app.import.output"), result.generatedAt());
    }
}
