package hermes

import "testing"

func TestNormalizeHermesProviderKey(t *testing.T) {
	cases := map[string]string{
		"NEX-LLM":         "nex-llm",
		"nex_llm":         "nex-llm",
		"nex-llm":         "nex-llm",
		"custom-provider": "custom-provider",
	}
	for input, expected := range cases {
		if actual := normalizeHermesProviderKey(input); actual != expected {
			t.Fatalf("normalizeHermesProviderKey(%q) = %q, want %q", input, actual, expected)
		}
	}
}

func TestNormalizeHermesConfigProviderAliases(t *testing.T) {
	config := map[string]any{
		"model": map[string]any{
			"provider": "NEX-LLM",
		},
		"providers": map[string]any{
			"NEX-LLM": map[string]any{"base_url": "https://example.test"},
		},
		"auxiliary": map[string]any{
			"vision": map[string]any{"provider": "NEX-LLM"},
		},
		"fallback_providers": []any{
			map[string]any{"provider": "NEX-LLM", "model": "gpt-5.5"},
		},
	}

	if !normalizeHermesConfigProviderAliases(config) {
		t.Fatal("expected config aliases to change")
	}

	model := objectMap(config["model"])
	if model["provider"] != "nex-llm" {
		t.Fatalf("expected model.provider nex-llm, got %v", model["provider"])
	}
	providers := objectMap(config["providers"])
	if _, ok := providers["nex-llm"]; !ok {
		t.Fatal("expected providers.nex-llm to exist")
	}
	if _, ok := providers["NEX-LLM"]; ok {
		t.Fatal("expected providers.NEX-LLM to be removed")
	}
	vision := objectMap(objectMap(config["auxiliary"])["vision"])
	if vision["provider"] != "nex-llm" {
		t.Fatalf("expected auxiliary.vision.provider nex-llm, got %v", vision["provider"])
	}
	fallback := objectMap(config["fallback_providers"].([]any)[0])
	if fallback["provider"] != "nex-llm" {
		t.Fatalf("expected fallback provider nex-llm, got %v", fallback["provider"])
	}
}
