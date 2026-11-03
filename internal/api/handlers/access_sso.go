package handlers

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/clawvisor/clawvisor/pkg/config"
	"github.com/clawvisor/clawvisor/pkg/store"
	"github.com/golang-jwt/jwt/v5"
)

// Only the assertion's verified claims establish identity. Neither the email
// header nor an unverified cookie is trusted, including on the private origin.
type accessIdentityVerifier struct {
	cfg     config.AccessSSOConfig
	client  *http.Client
	mu      sync.Mutex
	keys    map[string]*rsa.PublicKey
	expires time.Time
}

func newAccessIdentityVerifier(cfg config.AccessSSOConfig) *accessIdentityVerifier {
	return &accessIdentityVerifier{cfg: cfg, client: &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

type accessClaims struct {
	jwt.RegisteredClaims
	Email string `json:"email"`
	Type  string `json:"type"`
}

func (v *accessIdentityVerifier) email(r *http.Request) (string, error) {
	if v == nil {
		return "", errors.New("SSO unavailable")
	}
	u, err := url.Parse(v.cfg.Issuer)
	if err != nil || u.Scheme != "https" || !strings.HasSuffix(u.Hostname(), ".cloudflareaccess.com") || u.Port() != "" || u.Path != "" || u.RawQuery != "" || u.User != nil || u.Fragment != "" || v.cfg.Audience == "" || len(v.cfg.Emails) == 0 {
		return "", errors.New("invalid SSO configuration")
	}
	raw := r.Header.Get("Cf-Access-Jwt-Assertion")
	if raw == "" || len(raw) > 16384 {
		return "", errors.New("missing assertion")
	}
	claims := &accessClaims{}
	_, err = jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		return v.key(r, kid)
	}, jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(v.cfg.Issuer), jwt.WithAudience(v.cfg.Audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil || claims.Subject == "" || claims.Type != "app" {
		return "", errors.New("invalid assertion")
	}
	email := strings.ToLower(strings.TrimSpace(claims.Email))
	if !strings.HasSuffix(email, "@ontora.com") || strings.Count(email, "@") != 1 {
		return "", errors.New("Ontora account required")
	}
	for _, allowed := range v.cfg.Emails {
		if strings.EqualFold(email, strings.TrimSpace(allowed)) {
			return email, nil
		}
	}
	return "", errors.New("founder account required")
}
func (v *accessIdentityVerifier) key(r *http.Request, kid string) (*rsa.PublicKey, error) {
	if kid == "" {
		return nil, errors.New("missing key ID")
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	// Unknown keys do not force network calls while the cache is fresh, keeping
	// forged assertions from turning this endpoint into an outbound request flood.
	if time.Now().Before(v.expires) {
		if k := v.keys[kid]; k != nil {
			return k, nil
		}
		return nil, errors.New("unknown signing key")
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, v.cfg.Issuer+"/cdn-cgi/access/certs", nil)
	if err != nil {
		return nil, err
	}
	resp, err := v.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("signing keys unavailable")
	}
	var jwks struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			Alg string `json:"alg"`
			Use string `json:"use"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&jwks); err != nil {
		return nil, err
	}
	keys := map[string]*rsa.PublicKey{}
	for _, j := range jwks.Keys {
		if j.Kty != "RSA" || j.Alg != "RS256" || j.Use != "sig" {
			continue
		}
		n, e1 := base64.RawURLEncoding.DecodeString(j.N)
		e, e2 := base64.RawURLEncoding.DecodeString(j.E)
		if e1 != nil || e2 != nil || len(n) < 256 || len(e) == 0 || len(e) > 4 {
			continue
		}
		exponent := new(big.Int).SetBytes(e).Int64()
		if exponent < 3 || exponent > 2147483647 || exponent%2 == 0 {
			continue
		}
		keys[j.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(exponent)}
	}
	v.keys = keys
	v.expires = time.Now().Add(5 * time.Minute)
	if k := keys[kid]; k != nil {
		return k, nil
	}
	return nil, errors.New("unknown signing key")
}

// AccessLogin exchanges an already authenticated Cloudflare human identity for
// an application session. Provisioning is limited to the operator's exact list.
// Passwords are random and never exposed; existing data and roles are preserved.
func (h *AuthHandler) AccessLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.cfg.AccessSSO.Enabled {
		writeError(w, 404, "NOT_ENABLED", "SSO is not enabled")
		return
	}
	if r.Header.Get("Origin") != strings.TrimRight(h.baseURL, "/") {
		writeError(w, 403, "INVALID_ORIGIN", "Open Clawvisor at its public URL to sign in.")
		return
	}
	email, err := h.accessSSO.email(r)
	if err != nil {
		writeError(w, 401, "SSO_REQUIRED", "Sign in with an authorized Ontora Google account.")
		return
	}
	user, err := h.st.GetUserByEmail(r.Context(), email)
	// Older password accounts may have mixed-case emails. Preserve their data
	// and roles, but refuse ambiguous legacy identities rather than merging them.
	if errors.Is(err, store.ErrNotFound) {
		users, listErr := h.st.ListUsers(r.Context())
		if listErr != nil {
			writeError(w, 500, "INTERNAL_ERROR", "Could not load account.")
			return
		}
		for _, existing := range users {
			if strings.EqualFold(existing.Email, email) {
				if user != nil {
					writeError(w, 409, "AMBIGUOUS_IDENTITY", "Contact your administrator to resolve duplicate accounts.")
					return
				}
				user = existing
			}
		}
		if user != nil {
			err = nil
		}
	}
	if errors.Is(err, store.ErrNotFound) {
		role := store.RoleMember
		if strings.EqualFold(email, h.cfg.AccessSSO.BootstrapAdmin) {
			role = store.RoleAdmin
		}
		secret := make([]byte, 32)
		if _, err = rand.Read(secret); err != nil {
			writeError(w, 500, "INTERNAL_ERROR", "Could not create account.")
			return
		}
		// No usable password is provisioned. Password routes are disabled in SSO mode.
		user, err = h.st.CreateUser(r.Context(), email, "!sso:"+base64.RawURLEncoding.EncodeToString(secret), role)
		if errors.Is(err, store.ErrConflict) {
			user, err = h.st.GetUserByEmail(r.Context(), email)
		}
	}
	if err != nil {
		writeError(w, 500, "INTERNAL_ERROR", "Could not load account.")
		return
	}
	if !user.Verified() {
		if err = h.st.MarkUserVerified(r.Context(), user.ID); err != nil {
			writeError(w, 500, "INTERNAL_ERROR", "Could not confirm account.")
			return
		}
		now := time.Now().UTC()
		user.VerifiedAt = &now
	}
	resp, err := h.issueTokens(w, r, user)
	if err != nil {
		writeError(w, 500, "INTERNAL_ERROR", "Could not create session.")
		return
	}
	writeJSON(w, 200, resp)
}

// ProtectAccessSessions requires the same live Access identity for every valid
// application bearer session, including sessions issued before SSO was enabled.
// Agent and scoped API tokens keep their existing independent authentication.
func (h *AuthHandler) ProtectAccessSessions(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if claims, err := h.jwtSvc.ValidateToken(raw); err == nil {
			email, err := h.accessSSO.email(r)
			if err != nil || !strings.EqualFold(email, claims.Email) {
				writeError(w, 401, "SSO_REQUIRED", "Sign in with your Ontora Google account.")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
