package com.huawei.opsfactory.knowledge.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import org.apache.tika.Tika;
import org.apache.tika.metadata.Metadata;
import org.apache.tika.parser.AutoDetectParser;
import org.apache.tika.parser.ParseContext;
import org.apache.tika.sax.BodyContentHandler;
import org.springframework.stereotype.Service;
import org.xml.sax.SAXException;

@Service
public class TikaConversionService {

    private final Tika tika = new Tika();
    private final AutoDetectParser parser = new AutoDetectParser();

    public ConversionResult convert(Path file) {
        Metadata metadata = new Metadata();
        BodyContentHandler handler = new BodyContentHandler(-1);
        try (var inputStream = Files.newInputStream(file)) {
            parser.parse(inputStream, handler, metadata, new ParseContext());
            String text = Optional.ofNullable(handler.toString()).orElse("").trim();
            String title = Optional.ofNullable(metadata.get("title"))
                .filter(s -> !s.isBlank())
                .orElse(file.getFileName().toString());
            String contentType = Optional.ofNullable(metadata.get(Metadata.CONTENT_TYPE))
                .orElseGet(() -> detectType(file));
            return new ConversionResult(title, contentType, text, text);
        } catch (IOException | SAXException | org.apache.tika.exception.TikaException e) {
            throw new IllegalStateException("Failed to convert file " + file, e);
        }
    }

    public String detectType(Path file) {
        try {
            return tika.detect(file);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to detect file type " + file, e);
        }
    }

    public record ConversionResult(String title, String contentType, String text, String markdown) {
    }
}
