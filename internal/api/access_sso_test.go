package api_test

import (
	"net/http"
	"testing"

	"github.com/clawvisor/clawvisor/pkg/config"
)

func TestAccessSSO_DisablesPasswordAndLocalEnrollment(t *testing.T) {
	env := newTestEnvWithConfig(t, config.LLMConfig{}, nil, func(cfg *config.Config) {
		cfg.Auth.AccessSSO = config.AccessSSOConfig{Enabled: true, Issuer: "https://test.cloudflareaccess.com", Audience: "test-app", Emails: []string{"max@ontora.com"}, BootstrapAdmin: "max@ontora.com"}
	})
	for _, path := range []string{"/api/auth/register", "/api/auth/login", "/api/auth/magic/local", "/api/auth/magic", "/api/users/invites"} {
		t.Run(path, func(t *testing.T) {
			resp := env.do("POST", path, "", map[string]any{"email": "max@ontora.com", "password": "password123"})
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusNotFound && resp.StatusCode != http.StatusMethodNotAllowed {
				t.Fatalf("disabled route status %d", resp.StatusCode)
			}
		})
	}
	resp := env.do("GET", "/api/config/public", "", nil)
	body := mustStatus(t, resp, http.StatusOK)
	if body["auth_mode"] != "cloudflare" {
		t.Fatalf("auth mode %v", body)
	}
	resp = env.do("GET", "/api/features", "", nil)
	body = mustStatus(t, resp, http.StatusOK)
	if body["password_auth"] != false {
		t.Fatalf("password feature %v", body)
	}
	resp = env.do("POST", "/api/auth/access", "", nil)
	defer resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatalf("missing browser origin status %d", resp.StatusCode)
	}
	resp = env.do("POST", "/api/auth/refresh", "", nil)
	defer resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("refresh without Access status %d", resp.StatusCode)
	}
}
