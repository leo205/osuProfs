package org.osuprofs;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class OsuProfsApplication {
    public static void main(String[] args) {
        var context = SpringApplication.run(OsuProfsApplication.class, args);
        if (context.getEnvironment().getProperty("app.import.enabled", Boolean.class, false)) context.close();
    }
}
