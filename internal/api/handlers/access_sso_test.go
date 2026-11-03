package handlers

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	intauth "github.com/clawvisor/clawvisor/internal/auth"
	"github.com/clawvisor/clawvisor/pkg/config"
	"github.com/clawvisor/clawvisor/pkg/store"
	sqlitestore "github.com/clawvisor/clawvisor/pkg/store/sqlite"
	"github.com/golang-jwt/jwt/v5"
)

type ssoTransport func(*http.Request) (*http.Response, error)

func (f ssoTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func ssoFixture(t *testing.T) (*accessIdentityVerifier, *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	v := newAccessIdentityVerifier(config.AccessSSOConfig{Enabled: true, Issuer: "https://test.cloudflareaccess.com", Audience: "test-app", Emails: []string{"max@ontora.com", "leon@ontora.com"}, BootstrapAdmin: "max@ontora.com"})
	jwks, _ := json.Marshal(map[string]any{"keys": []map[string]string{{"kid": "key-1", "kty": "RSA", "alg": "RS256", "use": "sig", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())}}})
	v.client = &http.Client{Transport: ssoTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != v.cfg.Issuer+"/cdn-cgi/access/certs" {
			t.Fatalf("unexpected key URL %s", r.URL)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(jwks)))}, nil
	})}
	return v, key
}
func ssoClaims() accessClaims {
	return accessClaims{RegisteredClaims: jwt.RegisteredClaims{Issuer: "https://test.cloudflareaccess.com", Audience: jwt.ClaimStrings{"test-app"}, Subject: "human-identity", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)), IssuedAt: jwt.NewNumericDate(time.Now().Add(-time.Minute))}, Email: "max@ontora.com", Type: "app"}
}
func ssoSign(t *testing.T, key *rsa.PrivateKey, c accessClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, c)
	tok.Header["kid"] = "key-1"
	raw, err := tok.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func TestAccessRejectsUntrustedSigningMethods(t *testing.T) {
	v, _ := ssoFixture(t)
	for _, method := range []jwt.SigningMethod{jwt.SigningMethodNone, jwt.SigningMethodHS256} {
		tok := jwt.NewWithClaims(method, ssoClaims())
		tok.Header["kid"] = "key-1"
		var key any = []byte("forged")
		if method == jwt.SigningMethodNone {
			key = jwt.UnsafeAllowNoneSignatureType
		}
		raw, err := tok.SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest("POST", "/", nil)
		r.Header.Set("Cf-Access-Jwt-Assertion", raw)
		if _, err := v.email(r); err == nil {
			t.Fatal("accepted untrusted algorithm")
		}
	}
}

func TestAccessIdentityValidation(t *testing.T) {
	v, key := ssoFixture(t)
	cases := []struct {
		name   string
		mutate func(*accessClaims)
		valid  bool
	}{
		{"founder", func(c *accessClaims) {}, true},
		{"case normalized", func(c *accessClaims) { c.Email = "MAX@ontora.com" }, true},
		{"wrong issuer", func(c *accessClaims) { c.Issuer = "https://attacker.cloudflareaccess.com" }, false},
		{"wrong audience", func(c *accessClaims) { c.Audience = jwt.ClaimStrings{"other-app"} }, false},
		{"expired", func(c *accessClaims) { c.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Minute)) }, false},
		{"missing expiry", func(c *accessClaims) { c.ExpiresAt = nil }, false},
		{"future", func(c *accessClaims) { c.NotBefore = jwt.NewNumericDate(time.Now().Add(time.Hour)) }, false},
		{"service identity", func(c *accessClaims) { c.Type = "service" }, false},
		{"no subject", func(c *accessClaims) { c.Subject = "" }, false},
		{"non-founder", func(c *accessClaims) { c.Email = "staff@ontora.com" }, false},
		{"foreign email", func(c *accessClaims) { c.Email = "max@gmail.com" }, false},
		{"suffix lookalike", func(c *accessClaims) { c.Email = "max@ontora.com.evil.test" }, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := ssoClaims()
			tc.mutate(&c)
			r := httptest.NewRequest("POST", "/", nil)
			r.Header.Set("Cf-Access-Jwt-Assertion", ssoSign(t, key, c))
			_, err := v.email(r)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, err)
			}
		})
	}
	t.Run("forged signature", func(t *testing.T) {
		other, _ := rsa.GenerateKey(rand.Reader, 2048)
		r := httptest.NewRequest("POST", "/", nil)
		r.Header.Set("Cf-Access-Jwt-Assertion", ssoSign(t, other, ssoClaims()))
		if _, err := v.email(r); err == nil {
			t.Fatal("accepted forged assertion")
		}
	})
	t.Run("unsigned email header", func(t *testing.T) {
		r := httptest.NewRequest("POST", "/", nil)
		r.Header.Set("Cf-Access-Authenticated-User-Email", "max@ontora.com")
		if _, err := v.email(r); err == nil {
			t.Fatal("trusted email header")
		}
	})
	t.Run("empty allowlist", func(t *testing.T) {
		copy := newAccessIdentityVerifier(v.cfg)
		copy.cfg.Emails = nil
		r := httptest.NewRequest("POST", "/", nil)
		r.Header.Set("Cf-Access-Jwt-Assertion", ssoSign(t, key, ssoClaims()))
		if _, err := copy.email(r); err == nil {
			t.Fatal("empty allowlist accepted")
		}
	})
}
func TestAccessLoginAndSessionBoundary(t *testing.T) {
	v, key := ssoFixture(t)
	ctx := context.Background()
	db, err := sqlitestore.New(ctx, t.TempDir()+"/sso.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	st := sqlitestore.NewStore(db)
	svc, err := intauth.NewJWTService(strings.Repeat("x", 32))
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.AuthConfig{AccessSSO: v.cfg, AccessTokenTTL: "15m", RefreshTokenTTL: "24h"}
	h := NewAuthHandler(svc, st, cfg, nil, "https://clawvisor.example", false)
	h.accessSSO = v
	login := func(email, origin string) *httptest.ResponseRecorder {
		c := ssoClaims()
		c.Email = email
		r := httptest.NewRequest("POST", "/api/auth/access", nil)
		r.Header.Set("Origin", origin)
		r.Header.Set("Cf-Access-Jwt-Assertion", ssoSign(t, key, c))
		w := httptest.NewRecorder()
		h.AccessLogin(w, r)
		return w
	}
	if w := login("max@ontora.com", "https://evil.example"); w.Code != 403 {
		t.Fatalf("CSRF status %d", w.Code)
	}
	if w := login("staff@ontora.com", "https://clawvisor.example"); w.Code != 401 {
		t.Fatalf("nonfounder status %d", w.Code)
	}
	w := login("max@ontora.com", "https://clawvisor.example")
	if w.Code != 200 {
		t.Fatalf("login %d %s", w.Code, w.Body)
	}
	max, err := st.GetUserByEmail(ctx, "max@ontora.com")
	if err != nil || max.Role != store.RoleAdmin || !max.Verified() {
		t.Fatalf("admin provision: %v %v", max, err)
	}
	inv := &store.UserInvite{TokenHash: "synthetic-invite-hash", Email: "leon@ontora.com", Role: store.RoleMember, CreatedBy: &max.ID, ExpiresAt: time.Now().Add(time.Hour)}
	if err := st.CreateUserInvite(ctx, inv); err != nil {
		t.Fatal(err)
	}
	pending, err := st.ClaimInvitedUser(ctx, inv.ID, "leon@ontora.com", "!pending", store.RoleMember)
	if err != nil || pending.Verified() {
		t.Fatalf("pending fixture: %v %v", pending, err)
	}
	w = login("leon@ontora.com", "https://clawvisor.example")
	if w.Code != 200 {
		t.Fatalf("member login %d", w.Code)
	}
	leon, _ := st.GetUserByEmail(ctx, "leon@ontora.com")
	if leon.Role != store.RoleMember || !leon.Verified() || leon.ID != pending.ID {
		t.Fatal("member elevated")
	}
	login("max@ontora.com", "https://clawvisor.example")
	count, _ := st.CountUsers(ctx)
	if count != 2 {
		t.Fatalf("duplicate accounts: %d", count)
	}
	token, _ := svc.GenerateAccessToken(max.ID, max.Email, time.Minute)
	protected := h.ProtectAccessSessions(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	for _, tc := range []struct {
		name, email string
		status      int
	}{{"private JWT without Access", "", 401}, {"different identity", "leon@ontora.com", 401}, {"matching founder", "max@ontora.com", 204}} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/api/me", nil)
			r.Header.Set("Authorization", "Bearer "+token)
			if tc.email != "" {
				c := ssoClaims()
				c.Email = tc.email
				r.Header.Set("Cf-Access-Jwt-Assertion", ssoSign(t, key, c))
			}
			w := httptest.NewRecorder()
			protected.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("status %d", w.Code)
			}
		})
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer cvis_agent-token")
	w = httptest.NewRecorder()
	protected.ServeHTTP(w, r)
	if w.Code != 204 {
		t.Fatal("interfered with agent auth")
	}
}
