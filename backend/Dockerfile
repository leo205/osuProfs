FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY backend/pom.xml ./
RUN mvn -B dependency:go-offline
COPY backend/src ./src
RUN mvn -B package -DskipTests

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S -G app app
COPY --from=build /app/target/osu-profs-0.1.0.jar app.jar
COPY frontend/public/data /app/data
ENV CATALOG_PATH=/app/data/catalog-index.json
USER app
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=50 -XX:InitialRAMPercentage=15 -XX:+UseSerialGC -XX:MaxMetaspaceSize=128m -Xss256k"
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
