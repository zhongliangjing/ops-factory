package com.huawei.opsfactory.knowledge.common.error;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

class ApiExceptionHandlerTest {

    private final MockMvc mockMvc = MockMvcBuilders
        .standaloneSetup(new FailingController())
        .setControllerAdvice(new ApiExceptionHandler())
        .build();

    @Test
    void shouldMapRetrievalConfigurationExceptionToServerErrorInsteadOfNotFound() throws Exception {
        mockMvc.perform(get("/__test__/retrieval-config-error").accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.code").value("RETRIEVAL_CONFIGURATION_ERROR"))
            .andExpect(jsonPath("$.message").value("Embedding dimension mismatch"));
    }

    @Test
    void shouldMapApiConflictExceptionToConflictStatus() throws Exception {
        mockMvc.perform(get("/__test__/conflict-error").accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("SOURCE_IN_MAINTENANCE"))
            .andExpect(jsonPath("$.message").value("知识库重建中，请稍后再试"));
    }

    @Test
    void shouldMapIllegalArgumentExceptionToNotFound() throws Exception {
        mockMvc.perform(get("/__test__/not-found-error").accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"))
            .andExpect(jsonPath("$.message").value("Source not found: src_999"));
    }

    @Test
    void shouldMapIllegalStateExceptionToBadRequest() throws Exception {
        mockMvc.perform(get("/__test__/bad-request-error").accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("REQUEST_FAILED"))
            .andExpect(jsonPath("$.message").value("Unsupported content type: application/x-msdownload"));
    }

    @RestController
    static class FailingController {
        @GetMapping("/__test__/retrieval-config-error")
        void throwRetrievalConfigurationException() {
            throw new RetrievalConfigurationException("Embedding dimension mismatch");
        }

        @GetMapping("/__test__/conflict-error")
        void throwApiConflictException() {
            throw new ApiConflictException("SOURCE_IN_MAINTENANCE", "知识库重建中，请稍后再试");
        }

        @GetMapping("/__test__/not-found-error")
        void throwIllegalArgumentException() {
            throw new IllegalArgumentException("Source not found: src_999");
        }

        @GetMapping("/__test__/bad-request-error")
        void throwIllegalStateException() {
            throw new IllegalStateException("Unsupported content type: application/x-msdownload");
        }
    }
}
