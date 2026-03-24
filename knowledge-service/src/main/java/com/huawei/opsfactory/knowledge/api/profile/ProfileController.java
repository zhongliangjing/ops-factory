package com.huawei.opsfactory.knowledge.api.profile;

import com.huawei.opsfactory.knowledge.common.model.PageResponse;
import com.huawei.opsfactory.knowledge.service.KnowledgeServiceFacade;
import java.time.Instant;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/ops-knowledge/profiles")
public class ProfileController {

    private final KnowledgeServiceFacade facade;

    public ProfileController(KnowledgeServiceFacade facade) {
        this.facade = facade;
    }

    @GetMapping("/index")
    public PageResponse<ProfileSummary> listIndexProfiles(
        @RequestParam(defaultValue = "1") int page,
        @RequestParam(defaultValue = "20") int pageSize
    ) {
        return facade.listIndexProfiles(page, pageSize);
    }

    @PostMapping("/index")
    public ProfileDetail createIndexProfile(@RequestBody CreateProfileRequest request) {
        return facade.createIndexProfile(request);
    }

    @GetMapping("/index/{profileId}")
    public ProfileDetail getIndexProfile(@PathVariable("profileId") String profileId) {
        return facade.getIndexProfile(profileId);
    }

    @PatchMapping("/index/{profileId}")
    public ProfileUpdateResponse updateIndexProfile(@PathVariable("profileId") String profileId, @RequestBody UpdateProfileRequest request) {
        return facade.updateIndexProfile(profileId, request);
    }

    @DeleteMapping("/index/{profileId}")
    public DeleteProfileResponse deleteIndexProfile(@PathVariable("profileId") String profileId) {
        return facade.deleteIndexProfile(profileId);
    }

    @GetMapping("/retrieval")
    public PageResponse<ProfileSummary> listRetrievalProfiles(
        @RequestParam(defaultValue = "1") int page,
        @RequestParam(defaultValue = "20") int pageSize
    ) {
        return facade.listRetrievalProfiles(page, pageSize);
    }

    @PostMapping("/retrieval")
    public ProfileDetail createRetrievalProfile(@RequestBody CreateProfileRequest request) {
        return facade.createRetrievalProfile(request);
    }

    @GetMapping("/retrieval/{profileId}")
    public ProfileDetail getRetrievalProfile(@PathVariable("profileId") String profileId) {
        return facade.getRetrievalProfile(profileId);
    }

    @PatchMapping("/retrieval/{profileId}")
    public ProfileUpdateResponse updateRetrievalProfile(@PathVariable("profileId") String profileId, @RequestBody UpdateProfileRequest request) {
        return facade.updateRetrievalProfile(profileId, request);
    }

    @DeleteMapping("/retrieval/{profileId}")
    public DeleteProfileResponse deleteRetrievalProfile(@PathVariable("profileId") String profileId) {
        return facade.deleteRetrievalProfile(profileId);
    }

    @GetMapping("/bindings")
    public PageResponse<BindingResponse> listBindings(
        @RequestParam(defaultValue = "1") int page,
        @RequestParam(defaultValue = "20") int pageSize
    ) {
        return facade.listBindings(page, pageSize);
    }

    @PostMapping("/bind")
    public BindingResponse bindProfiles(@RequestBody BindingRequest request) {
        return facade.bindProfiles(request);
    }

    @PatchMapping("/bindings/{sourceId}")
    public BindingResponse updateBinding(@PathVariable("sourceId") String sourceId, @RequestBody BindingPatchRequest request) {
        return facade.updateBinding(sourceId, request);
    }

    public record ProfileSummary(
        String id,
        String name,
        Map<String, Object> summary,
        Instant createdAt,
        Instant updatedAt
    ) {
    }

    public record CreateProfileRequest(String name, Map<String, Object> config) {
    }

    public record UpdateProfileRequest(String name, Map<String, Object> config) {
    }

    public record ProfileDetail(String id, String name, Map<String, Object> config, Instant createdAt, Instant updatedAt) {
    }

    public record ProfileUpdateResponse(String id, String name, Instant updatedAt) {
    }

    public record DeleteProfileResponse(String profileId, boolean deleted) {
    }

    public record BindingRequest(String sourceId, String indexProfileId, String retrievalProfileId) {
    }

    public record BindingPatchRequest(String indexProfileId, String retrievalProfileId) {
    }

    public record BindingResponse(String sourceId, String indexProfileId, String retrievalProfileId, Instant updatedAt) {
    }
}
